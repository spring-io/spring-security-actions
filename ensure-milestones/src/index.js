import fs from "node:fs";
import path from "node:path";
import * as core from "@actions/core";
import { call, createOctokit, parseRepository } from "./octokit.js";
import { execute, isMain, TitledError } from "./run.js";
import { addSummary, table } from "./summary.js";
import { wantedFor } from "./state.js";

export const DEFAULT_ENSURED_FILE = "code-freeze/milestones-ensured.json";

/** The line that says where the OSS milestone of a commercial one is. */
export const linkLine = (url) => `OSS milestone: ${url}`;

/** The description of a milestone with the link to the OSS one added, and the rest kept. */
export function withLink(description, url) {
  const text = description ?? "";
  if (text.includes(url)) {
    return text;
  }
  return text.trim() === ""
    ? linkLine(url)
    : `${text.trimEnd()}\n\n${linkLine(url)}`;
}

/** The OSS repository and the commercial one, from either: the commercial one ends with -commercial. */
export function repositoriesOf(repository) {
  return repository.endsWith("-commercial")
    ? { oss: repository.slice(0, -"-commercial".length), host: repository }
    : { oss: repository, host: `${repository}-commercial` };
}

const VERSION_LINE = /^version=([^\r\n]*)/m;

/**
 * The versions of the branches of the commercial repository, from `gradle.properties` on
 * each: the frozen branches (one for each OSS generation, the version that it builds next) and
 * the long-term support ones. It reads what is there now, after a freeze has bumped it.
 */
export async function versionsOf(octokit, host) {
  const target = parseRepository(host);
  const names = (
    await call(
      `Reading the branches of ${host}`,
      octokit.paginate(octokit.rest.repos.listBranches, {
        ...target,
        per_page: 100,
      }),
    )
  ).map((b) => b.name);
  const versions = [];
  for (const [prefix, lts] of [
    ["embargoed/frozen/", false],
    ["embargoed/lts/", true],
  ]) {
    for (const branch of names.filter((n) => n.startsWith(prefix))) {
      try {
        const { data } = await octokit.rest.repos.getContent({
          ...target,
          path: "gradle.properties",
          ref: branch,
        });
        const text = Buffer.from(data.content, "base64").toString("utf8");
        const version = VERSION_LINE.exec(text)?.[1]?.trim();
        if (version) {
          versions.push({ branch, version, lts });
        }
      } catch (error) {
        if (error.status !== 404) {
          throw error;
        }
      }
    }
  }
  return versions;
}

/**
 * Makes the milestones of a project what its versions say they should be, and closes the ones
 * that are done (see wantedFor, which has the rules): it closes a milestone that is open, makes
 * one that is not there (with a title only, open or closed counts as there), and adds the link
 * to the OSS milestone to the commercial one that tracks it. It never deletes a milestone, never
 * reopens one, and leaves alone what is right, so that a run that is done again does nothing.
 *
 * `versions` are { version, lts } for each branch, and `closing` the OSS milestones that a
 * code freeze closes (taken as closed). With `dryRun` nothing is written: `results` has what
 * would be done. It goes on after one that fails, and says which.
 */
export async function ensureMilestones(
  { repositories, versions, closing = [], dryRun = false },
  { octokit, log = () => {} },
) {
  const { oss, host } = repositories;
  const lists = new Map();
  const list = async (repository) => {
    if (!lists.has(repository)) {
      const { owner, repo } = parseRepository(repository);
      lists.set(
        repository,
        await call(
          `Reading the milestones of ${repository}`,
          octokit.paginate(octokit.rest.issues.listMilestones, {
            owner,
            repo,
            state: "all",
            per_page: 100,
          }),
        ),
      );
    }
    return lists.get(repository);
  };
  const repositoryOf = (which) => (which === "oss" ? oss : host);
  const find = async (which, title) =>
    (await list(repositoryOf(which))).find((m) => m.title === title);

  const ossMilestones = await list(oss);
  const wanted = { close: [], make: [], link: [], warnings: [] };
  const seen = new Set();
  const add = (kind, item) => {
    const key = `${kind} ${item.repository ?? "host"} ${item.title}`;
    if (!seen.has(key)) {
      seen.add(key);
      wanted[kind].push(item);
    }
  };
  for (const { version, lts, branch } of versions) {
    let one;
    try {
      one = wantedFor({ version, ossMilestones, closing, lts });
    } catch (error) {
      wanted.warnings.push(`${branch ?? version}: ${error.message}`);
      continue;
    }
    one.close.forEach((c) => add("close", c));
    one.make.forEach((m) => add("make", m));
    one.link.forEach((l) => add("link", l));
    wanted.warnings.push(...one.warnings);
  }

  const results = [];
  const record = (action, repository, title, result, extra = {}) => {
    results.push({ action, repository, title, result, ...extra });
    log(
      `${action} ${repository} ${title}: ${result}${extra.error ? `, ${extra.error}` : ""}`,
    );
  };
  const guard = async (action, repository, title, work) => {
    try {
      await work();
    } catch (error) {
      record(action, repository, title, "failed", { error: error.message });
    }
  };

  for (const { repository: which, title } of wanted.close) {
    const repository = repositoryOf(which);
    await guard("close", repository, title, async () => {
      const found = await find(which, title);
      if (!found) {
        return record("close", repository, title, "absent");
      }
      if (found.state === "closed") {
        return record("close", repository, title, "already-closed", {
          url: found.html_url,
        });
      }
      if (!dryRun) {
        const { owner, repo } = parseRepository(repository);
        await call(
          `Closing the milestone ${title} of ${repository}`,
          octokit.rest.issues.updateMilestone({
            owner,
            repo,
            milestone_number: found.number,
            state: "closed",
          }),
        );
      }
      found.state = "closed";
      record("close", repository, title, "closed", {
        url: found.html_url,
        open: found.open_issues,
      });
    });
  }

  for (const { repository: which, title, link } of wanted.make) {
    const repository = repositoryOf(which);
    await guard("make", repository, title, async () => {
      const found = await find(which, title);
      if (found) {
        return record("make", repository, title, "exists", {
          url: found.html_url,
        });
      }
      // a tracker after a release candidate is made only if OSS has its milestone: people plan them
      const ossOne = link ? await find("oss", title) : undefined;
      if (link && !ossOne) {
        return record("make", repository, title, "skipped", {
          reason: `${oss} has no milestone ${title}`,
        });
      }
      let made = {
        title,
        number: 0,
        state: "open",
        description: "",
        html_url: "",
      };
      if (!dryRun) {
        const { owner, repo } = parseRepository(repository);
        ({ data: made } = await call(
          `Creating the milestone ${title} of ${repository}`,
          octokit.rest.issues.createMilestone({
            owner,
            repo,
            title,
            ...(ossOne && { description: linkLine(ossOne.html_url) }),
          }),
        ));
      }
      (await list(repository)).push(made);
      record("make", repository, title, "created", { url: made.html_url });
    });
  }

  for (const { title } of wanted.link) {
    await guard("link", host, title, async () => {
      const ossOne = await find("oss", title);
      const hostOne = await find("host", title);
      if (!ossOne || !hostOne) {
        return record("link", host, title, "skipped", {
          reason: `${!ossOne ? oss : host} has no milestone ${title}`,
        });
      }
      const description = withLink(hostOne.description, ossOne.html_url);
      if (description === (hostOne.description ?? "")) {
        return record("link", host, title, "linked-already", {
          url: ossOne.html_url,
        });
      }
      if (!dryRun) {
        const { owner, repo } = parseRepository(host);
        await call(
          `Updating the description of the milestone ${title} of ${host}`,
          octokit.rest.issues.updateMilestone({
            owner,
            repo,
            milestone_number: hostOne.number,
            description,
          }),
        );
      }
      hostOne.description = description;
      record("link", host, title, "linked", { url: ossOne.html_url });
    });
  }
  return { results, warnings: wanted.warnings };
}

const RESULTS = {
  closed: ["Closed", "Would be closed"],
  "already-closed": ["Closed already", "Closed already"],
  absent: ["Not there", "Not there"],
  created: ["Made", "Would be made"],
  exists: ["There already", "There already"],
  linked: ["Link added", "Link would be added"],
  "linked-already": ["Has the link already", "Has the link already"],
};

/** The summary of a run, as markdown: what was done to each milestone, and the warnings. */
export function render({ repository, dryRun, results, warnings = [] }) {
  const lines = [
    `# Milestones of ${repository}${dryRun ? "     DRY RUN: nothing was written" : ""}`,
    "",
  ];
  if (warnings.length > 0) {
    lines.push("## Warnings", ...warnings.map((w) => `- ${w}`), "");
  }
  const rows = results.map((r) => [
    r.url ? `[${r.title}](${r.url})` : r.title,
    r.repository,
    { close: "Close", make: "Make", link: "Link to the OSS milestone" }[
      r.action
    ],
    r.result === "failed"
      ? `Failed: ${r.error}`
      : r.result === "skipped"
        ? `Skipped: ${r.reason}`
        : (RESULTS[r.result]?.[dryRun ? 1 : 0] ?? r.result),
  ]);
  lines.push(
    rows.length > 0
      ? table(["Milestone", "Repository", "What", "Result"], rows)
      : "Nothing to do.",
    "",
  );
  return lines.join("\n");
}

export async function main() {
  const repository = core.getInput("repository", { required: true });
  const dryRun = core.getInput("dry-run") === "true";
  const planFile = core.getInput("plan-file");
  const outputFile =
    core.getInput("output-file") ||
    path.join(process.env.RUNNER_TEMP ?? process.cwd(), DEFAULT_ENSURED_FILE);
  const repositories = repositoriesOf(repository);
  const octokit = createOctokit({ token: core.getInput("token") });

  let versions;
  let closing = [];
  if (planFile) {
    // before the branches are bumped (a dry run of the freeze): the versions that the plan has
    // for them, and the releases that the freeze closes
    const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
    versions = [
      ...plan.oss.map((g) => ({
        branch: g.branch,
        version: g.next,
        lts: false,
      })),
      ...plan.lts.map((g) => ({
        branch: g.branch,
        version: g.next,
        lts: true,
      })),
    ];
    closing = plan.releases
      .filter((r) => r.milestone?.repository === repositories.oss)
      .map((r) => r.version);
  } else {
    versions = await versionsOf(octokit, repositories.host);
  }
  const { results, warnings } = await ensureMilestones(
    { repositories, versions, closing, dryRun },
    { octokit, log: (line) => core.info(line) },
  );
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(
    outputFile,
    `${JSON.stringify({ results, warnings }, null, 2)}\n`,
  );
  core.setOutput("ensured-file", outputFile);
  warnings.forEach((w) => core.warning(w));
  addSummary(render({ repository, dryRun, results, warnings }));
  const failed = results.filter((r) => r.result === "failed");
  if (failed.length > 0) {
    throw new TitledError(
      "Milestones not made",
      `${failed.length === 1 ? "This milestone was" : "These milestones were"} not made, closed or linked: do it by hand.\n- ${failed.map((r) => `${r.action} ${r.repository} ${r.title}: ${r.error}`).join("\n- ")}`,
    );
  }
}

if (isMain(import.meta.url)) {
  execute(main);
}
