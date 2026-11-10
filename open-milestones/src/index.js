import fs from "node:fs";
import path from "node:path";
import * as core from "@actions/core";
import { call, createOctokit, parseRepository } from "./octokit.js";
import { execute, isMain, TitledError } from "./run.js";

export const DEFAULT_PLAN_FILE = "code-freeze/plan.json";
export const DEFAULT_OPENED_FILE = "code-freeze/milestones-opened.json";

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

/**
 * Makes the milestones of the next cycle of a code freeze, and links the trackers of the
 * fixes to the OSS milestones. The plan (`plan-freeze`) says which:
 *
 * - `creates`: a milestone that has no milestone of that title in its repository, open or
 *   closed, is made, with a title and nothing else (and the description, if the plan has
 *   one). One that is there is left alone.
 * - `links`: a commercial milestone gets the line `OSS milestone: <url>` added to its
 *   description, if it does not have the URL, and the rest of its description is kept. It is
 *   read again first: a tracker that the freeze deleted (it had no issues) is not there any
 *   more, and gets nothing.
 *
 * It goes on after one that fails, and says which failed. Returns what was done, in order.
 */
export async function openMilestones(
  { creates = [], links = [] },
  { octokit },
) {
  const lists = new Map();
  // the milestones of a repository, all states, read once: the ones that this run makes are added
  const milestonesOf = async (repository) => {
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
  const results = [];

  for (const create of creates) {
    const base = {
      kind: "create",
      repository: create.repository,
      title: create.title,
    };
    try {
      const milestones = await milestonesOf(create.repository);
      const found = milestones.find((m) => m.title === create.title);
      if (found) {
        results.push({ ...base, result: "exists", url: found.html_url });
        continue;
      }
      const { owner, repo } = parseRepository(create.repository);
      const { data } = await call(
        `Creating the milestone ${create.title} of ${create.repository}`,
        octokit.rest.issues.createMilestone({
          owner,
          repo,
          title: create.title,
          ...(create.description && { description: create.description }),
        }),
      );
      milestones.push(data);
      results.push({ ...base, result: "created", url: data.html_url });
    } catch (error) {
      results.push({ ...base, result: "failed", error: error.message });
    }
  }

  for (const link of links) {
    const base = {
      kind: "link",
      repository: link.repository,
      title: link.title,
      ossTitle: link.ossTitle,
    };
    try {
      const oss = (await milestonesOf(link.ossRepository)).find(
        (m) => m.title === link.ossTitle,
      );
      if (!oss) {
        results.push({
          ...base,
          result: "skipped",
          reason: `${link.ossRepository} has no milestone ${link.ossTitle}`,
        });
        continue;
      }
      const tracker = (await milestonesOf(link.repository)).find(
        (m) => m.title === link.title,
      );
      if (!tracker) {
        results.push({
          ...base,
          result: "skipped",
          reason: `${link.repository} has no milestone ${link.title} (deleted: it had no issues)`,
        });
        continue;
      }
      // the milestone is read again: the list is older than the closing of it
      const { owner, repo } = parseRepository(link.repository);
      const { data } = await call(
        `Reading the milestone ${link.title} of ${link.repository}`,
        octokit.rest.issues.getMilestone({
          owner,
          repo,
          milestone_number: tracker.number,
        }),
      );
      const description = withLink(data.description, oss.html_url);
      if (description === (data.description ?? "")) {
        results.push({ ...base, result: "linked-already", url: oss.html_url });
        continue;
      }
      await call(
        `Updating the description of the milestone ${link.title} of ${link.repository}`,
        octokit.rest.issues.updateMilestone({
          owner,
          repo,
          milestone_number: tracker.number,
          description,
        }),
      );
      results.push({ ...base, result: "linked", url: oss.html_url });
    } catch (error) {
      results.push({ ...base, result: "failed", error: error.message });
    }
  }
  return results;
}

export async function main() {
  const base = process.env.RUNNER_TEMP ?? process.cwd();
  const planFile =
    core.getInput("plan-file") || path.join(base, DEFAULT_PLAN_FILE);
  const openedFile =
    core.getInput("opened-file") || path.join(base, DEFAULT_OPENED_FILE);
  const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
  const octokit = createOctokit({ token: core.getInput("token") });
  const results = await openMilestones(
    { creates: plan.creates, links: plan.links },
    { octokit },
  );
  fs.mkdirSync(path.dirname(openedFile), { recursive: true });
  fs.writeFileSync(openedFile, `${JSON.stringify(results, null, 2)}\n`);
  core.setOutput("opened-file", openedFile);
  for (const r of results) {
    core.info(
      `${r.kind} ${r.repository} ${r.title}: ${r.error ?? r.reason ?? r.result}`,
    );
  }
  const failed = results.filter((r) => r.result === "failed");
  if (failed.length > 0) {
    throw new TitledError(
      "Milestones not made",
      `The freeze is done, and ${failed.length === 1 ? "this milestone was" : "these milestones were"} not made or linked: do it by hand.\n- ${failed.map((r) => `${r.kind} ${r.repository} ${r.title}: ${r.error}`).join("\n- ")}`,
    );
  }
}

if (isMain(import.meta.url)) {
  execute(main);
}
