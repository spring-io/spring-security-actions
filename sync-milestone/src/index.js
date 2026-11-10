import * as core from "@actions/core";
import { createOctokit } from "./octokit.js";
import { execute, isMain } from "./run.js";
import { repositoriesOf, syncMilestone } from "./sync.js";
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

export async function main() {
  const repository = core.getInput("repository", { required: true });
  const title = core.getInput("milestone", { required: true });
  const octokit = createOctokit({ token: core.getInput("token") });
  if (await isOwnEdit(octokit, core.getInput("sender"))) {
    core.info(
      `${core.getInput("sender")} made the edit of ${title}, and is the user of the token: it is the edit of this handler, so it is left alone`,
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
