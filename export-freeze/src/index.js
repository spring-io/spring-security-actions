import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as core from "@actions/core";
import { git } from "./git.js";
import { execute, isMain } from "./run.js";
import { addSummary, table } from "./summary.js";

export const DEFAULT_PLAN_FILE = "code-freeze/plan.json";
export const DEFAULT_APPLY_FILE = "code-freeze/apply.json";

const short = (commit) => commit.slice(0, 7);

const HEADER = ["Repository", "Branch", "Commit", "Before", "New commits"];

/** The rows of the table of the branches, for the summary and for the README. */
function rowsOf(plan, branches) {
  const repositories = {
    oss: plan.ossRepository,
    commercial: plan.hostRepository,
  };
  return branches.map((b) => [
    repositories[b.repository] ?? b.repository,
    `\`${b.branch}\``,
    short(b.commit),
    b.changed ? short(b.before) : "up to date",
    String(b.commits),
  ]);
}

/** The commands to look at the freeze, with the first changed branch as the example. */
function inspectCommands(branches) {
  const example = branches.find((b) => b.changed) ?? branches[0];
  return [
    `git log --graph --oneline ${example.branch}`,
    ...(example.changed
      ? [
          `git log --oneline ${short(example.before)}..${example.branch}`,
          `git diff ${short(example.before)} ${example.branch}`,
        ]
      : []),
  ];
}

const title = (plan, dryRun) =>
  `Code freeze of ${plan.project}, release train ${plan.train}${dryRun ? " (dry run)" : ""}`;

/**
 * Exports the branches that apply-freeze made: a new git repository in `target`, with every
 * branch of the freeze (each named as it is in its repository), fetched from the work refs of the
 * clone, with the history of each so that the commit before is in it. It is for looking at the
 * freeze: it has no remote and no command that pushes. It returns
 * { branches: [{ repository, branch, commit, before, changed, commits }] }, and the directory has a
 * README.md with the table of the branches and how to look at them.
 */
export function exportFreeze({ directory, apply, plan, target, dryRun }) {
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
    throw new Error(`The directory ${target} exists, and is not empty`);
  }
  const twice = apply.branches.find(
    (b, i) => apply.branches.findIndex((o) => o.branch === b.branch) !== i,
  );
  if (twice) {
    throw new Error(
      `The branch ${twice.branch} is in the freeze of two repositories, and they cannot both be a branch of one export`,
    );
  }
  if (apply.branches.length === 0) {
    return { branches: [] };
  }
  const clone = path.resolve(directory);
  fs.mkdirSync(target, { recursive: true });
  git(target, "init", "-q");
  // No background maintenance: its lock files come and go while the directory is uploaded as an
  // artifact, and an upload that lists one that is gone fails.
  git(target, "config", "gc.auto", "0");
  git(target, "config", "maintenance.auto", "false");
  git(
    target,
    "fetch",
    "--quiet",
    "--no-tags",
    clone,
    ...apply.branches.map((b) => `${b.ref}:refs/heads/${b.branch}`),
  );
  git(target, "symbolic-ref", "HEAD", `refs/heads/${apply.branches[0].branch}`);
  const branches = apply.branches.map((b) => ({
    repository: b.repository,
    branch: b.branch,
    commit: git(target, "rev-parse", `refs/heads/${b.branch}`),
    before: b.before,
    changed: b.changed,
    commits: b.changed
      ? Number(
          git(
            target,
            "rev-list",
            "--count",
            `${b.before}..refs/heads/${b.branch}`,
          ),
        )
      : 0,
  }));
  fs.writeFileSync(
    path.join(target, "README.md"),
    [
      `# ${title(plan, dryRun)}`,
      "",
      `These branches are what the code freeze made in the clone of the runner.${dryRun ? " Nothing was pushed." : ""} Each is named as it is in its repository. This is for looking at the freeze: there is no remote, and nothing here pushes.`,
      "",
      table(HEADER, rowsOf(plan, branches)),
      "",
      "To look at them, from inside this directory, for example:",
      "",
      "```",
      ...inspectCommands(branches),
      "```",
      "",
    ].join("\n"),
  );
  return { branches };
}

export async function main() {
  const tmp = process.env.RUNNER_TEMP || os.tmpdir();
  const planFile =
    core.getInput("plan-file") || path.join(tmp, DEFAULT_PLAN_FILE);
  const applyFile =
    core.getInput("apply-file") || path.join(tmp, DEFAULT_APPLY_FILE);
  const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
  const apply = JSON.parse(fs.readFileSync(applyFile, "utf8"));
  const name = core.getInput("name") || `code-freeze-changes-${plan.train}`;
  const target = core.getInput("directory") || path.join(tmp, name);
  const dryRun = core.getInput("dry-run").trim().toLowerCase() === "true";
  const { branches } = exportFreeze({
    directory: core.getInput("path") || ".",
    apply,
    plan,
    target,
    dryRun,
  });
  const lines = [`### ${title(plan, dryRun)}: the changes`, ""];
  if (branches.length > 0) {
    lines.push(
      table(HEADER, rowsOf(plan, branches)),
      "",
      `Download the artifact \`${name}\`, unzip it, and from inside it, for example:`,
      "",
      "```",
      ...inspectCommands(branches),
      "```",
      "",
      "It is for looking only: it has no remote, and nothing in it pushes.",
    );
  } else {
    lines.push("There is nothing to export: the freeze changed no branch.");
  }
  addSummary(lines.join("\n"));
  core.setOutput("directory", target);
  core.setOutput("name", name);
  core.setOutput("count", String(branches.length));
  for (const b of branches) {
    core.info(`Exported ${b.branch} (${short(b.commit)}) in ${target}`);
  }
}

if (isMain(import.meta.url)) {
  execute(main);
}
