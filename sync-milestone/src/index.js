import * as core from "@actions/core";
import { createOctokit, parseRepository } from "./octokit.js";
import { execute, isMain } from "./run.js";
import { rebuildReleases } from "./rebuild.js";
import { repositoriesOf, syncAll, syncMilestone } from "./sync.js";
import { addSummary } from "./summary.js";

/**
 * The `changes` of the event of GitHub, from the input: JSON, or nothing for a run by hand.
 * `null` and `{}` are no changes.
 */
export function parseChanges(text) {
  if (!text || !text.trim()) {
    return undefined;
  }
  let changes;
  try {
    changes = JSON.parse(text);
  } catch (error) {
    throw new Error(`The input changes is not JSON: ${error.message}`);
  }
  return changes && Object.keys(changes).length > 0 ? changes : undefined;
}

/**
 * Whether the edit that started the run was made by the user of the token: the handler
 * writes the milestones with that token, and its own edits must not start it again.
 */
export async function isOwnEdit(octokit, sender) {
  if (!sender) {
    return false;
  }
  try {
    const { data } = await octokit.rest.users.getAuthenticated();
    return data.login.toLowerCase() === sender.toLowerCase();
  } catch {
    // a token that cannot say who it is: the edit is taken as made by a person
    return false;
  }
}

/**
 * What to do with an edit: it is the handler's own if the user of the token made it, and is
 * left alone, unless that user means it: a description that starts with ! says so
 * (`override`), and the handler takes the ! out before it does anything.
 */
export async function verdictOf(octokit, { repository, milestone, sender }) {
  if (!(await isOwnEdit(octokit, sender))) {
    return { skip: false, override: false };
  }
  const { owner, repo } = parseRepository(repository);
  const milestones = await octokit.paginate(
    octokit.rest.issues.listMilestones,
    { owner, repo, state: "all", per_page: 100 },
  );
  const found = milestones.find((m) => m.title === milestone);
  const override = Boolean(found?.description?.startsWith("!"));
  return { skip: !override, override };
}

const plural = (n, word) =>
  `${n} ${n === 1 ? word : word.replace(/ch$/, "che") + "s"}`;

/**
 * The summary of a run over all the milestones, as markdown: what each one did (or would do),
 * and the totals.
 */
export function renderAll({
  repository,
  dryRun,
  results,
  totals,
  rebuilds = [],
}) {
  const lines = [
    `# Sync of all the milestones of ${repository}${dryRun ? "     DRY RUN: nothing was written or run" : ""}`,
    "",
  ];
  for (const { repository: where, title, actions } of results) {
    lines.push(`## ${where} ${title}`, "");
    lines.push(
      ...(actions.length > 0
        ? actions.map((a) => `- ${a}`)
        : ["- nothing to change"]),
      "",
    );
  }
  if (rebuilds.length > 0) {
    lines.push("## Rebuilds of the release branches", "");
    lines.push(
      ...rebuilds.map(
        (r) =>
          `- ${r.branch} (${r.release}): ${r.result}${r.reason ? `, ${r.reason}` : ""}`,
      ),
      "",
    );
  }
  const verb = dryRun ? "would" : "did";
  lines.push(
    `**Totals:** ${plural(totals.milestones, "milestone")} looked at. ${plural(totals.descriptions, "description")} ${verb} change, ${plural(totals.dueDates, "due date")}, ${plural(totals.leaves, "release")} ${verb} leave a train${rebuilds.length > 0 ? `, ${plural(rebuilds.filter((r) => ["rebuilt", "would rebuild"].includes(r.result)).length, "branch")} ${dryRun ? "would be" : "were"} rebuilt` : ""}.`,
    "",
  );
  return lines.join("\n");
}

async function mainAll(octokit, repository) {
  const dryRun = core.getInput("dry-run") === "true";
  const { oss } = repositoriesOf(repository);
  const { results, totals } = await syncAll(
    {
      repository,
      project: core.getInput("project") || oss.split("/")[1],
      trainRepository:
        core.getInput("release-train-repository") || "spring-io/release-train",
      dispatch: core.getInput("dispatch") !== "false",
      dryRun,
    },
    { octokit, log: (line) => core.info(line) },
  );
  let rebuilds = [];
  if (core.getInput("rebuild") === "true") {
    ({ results: rebuilds } = await rebuildReleases(
      {
        repositories: repositoriesOf(repository),
        project: core.getInput("project") || oss.split("/")[1],
        trainRepository:
          core.getInput("release-train-repository") ||
          "spring-io/release-train",
        dryRun,
      },
      { octokit, log: (line) => core.info(line) },
    ));
  }
  core.setOutput("skipped", "false");
  core.setOutput(
    "changed",
    String(
      results.some((r) => r.events.length > 0) ||
        rebuilds.some((r) => r.result === "rebuilt"),
    ),
  );
  addSummary(renderAll({ repository, dryRun, results, totals, rebuilds }));
  const failed = rebuilds.filter((r) => r.result === "failed");
  if (failed.length > 0) {
    throw new Error(
      `The release workflow failed on ${failed.length} ${failed.length === 1 ? "branch" : "branches"}: ${failed.map((r) => `${r.branch} (${r.reason})`).join("; ")}`,
    );
  }
}

export async function main() {
  const repository = core.getInput("repository", { required: true });
  const octokit = createOctokit({ token: core.getInput("token") });
  if (core.getInput("all") === "true") {
    return mainAll(octokit, repository);
  }
  const title = core.getInput("milestone", { required: true });
  const verdict = await verdictOf(octokit, {
    repository,
    milestone: title,
    sender: core.getInput("sender"),
  });
  if (verdict.skip) {
    core.info(
      `${core.getInput("sender")} made the edit of ${title}, and is the user of the token: it is the edit of this handler, so it is left alone (a description that starts with ! asks for it)`,
    );
    core.setOutput("skipped", "true");
    addSummary(
      `Skipped: the edit of ${title} was made by the user of the token\n`,
    );
    return;
  }
  const { oss } = repositoriesOf(repository);
  const { actions } = await syncMilestone(
    {
      repository,
      milestone: title,
      changes: parseChanges(core.getInput("changes")),
      project: core.getInput("project") || oss.split("/")[1],
      trainRepository:
        core.getInput("release-train-repository") || "spring-io/release-train",
      dispatch: core.getInput("dispatch") !== "false",
      override: verdict.override,
      dryRun: core.getInput("dry-run") === "true",
    },
    { octokit, log: (line) => core.info(line) },
  );
  core.setOutput("skipped", "false");
  core.setOutput("changed", String(actions.length > 0));
  addSummary(
    `## Milestone ${title} of ${repository}\n\n${
      actions.length > 0
        ? actions.map((a) => `- ${a}`).join("\n")
        : "Nothing to change"
    }\n`,
  );
}

if (isMain(import.meta.url)) {
  execute(main);
}
