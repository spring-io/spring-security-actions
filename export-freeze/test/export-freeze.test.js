import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { exportFreeze } from "../src/index.js";
import { runAction } from "./support/run-action.js";

const git = (directory, ...args) =>
  execFileSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

/**
 * The clone that apply-freeze leaves, made by hand: the work refs of an OSS branch, 7.0.x (with
 * two commits made on it), of a commercial one, embargoed/active/7.0.x (the same, not changed),
 * and the apply file and the plan that describe them.
 */
function world() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "export-freeze-"));
  const clone = path.join(root, "clone");
  git(root, "init", "-q", "-b", "main", clone);
  git(clone, "config", "user.name", "Alice");
  git(clone, "config", "user.email", "alice@example.com");
  git(clone, "config", "commit.gpgsign", "false");
  const commit = (file, message) => {
    fs.writeFileSync(path.join(clone, file), `${message}\n`);
    git(clone, "add", "-A");
    git(clone, "commit", "-q", "-m", message);
    return git(clone, "rev-parse", "HEAD");
  };
  const before = commit("base.txt", "Base");
  commit("merge.txt", "Merge branch '7.0.x' into 7.1.x");
  const after = commit("version.txt", "Next Development Version (7.0.6)");
  git(clone, "update-ref", "refs/freeze/oss/7.0.x", after);
  git(
    clone,
    "update-ref",
    "refs/freeze/commercial/embargoed/active/7.0.x",
    before,
  );
  git(clone, "reset", "-q", "--hard", before);
  const apply = {
    branches: [
      {
        repository: "oss",
        branch: "7.0.x",
        ref: "refs/freeze/oss/7.0.x",
        before,
        after,
        changed: true,
      },
      {
        repository: "commercial",
        branch: "embargoed/active/7.0.x",
        ref: "refs/freeze/commercial/embargoed/active/7.0.x",
        before,
        after: before,
        changed: false,
      },
    ],
  };
  const plan = {
    project: "spring-security",
    train: "2026.11.19",
    ossRepository: "owner/spring-security",
    hostRepository: "owner/spring-security-commercial",
  };
  return { root, clone, apply, plan, before, after };
}

const heads = (directory) =>
  git(directory, "for-each-ref", "--format=%(refname:short)", "refs/heads")
    .split("\n")
    .sort();

const run = (w, target, extra = {}) =>
  exportFreeze({
    directory: w.clone,
    apply: w.apply,
    plan: w.plan,
    target,
    dryRun: true,
    ...extra,
  });

describe("exportFreeze", () => {
  it("makes a repository with the branches of the freeze, named as in their repositories", () => {
    const w = world();
    const target = path.join(w.root, "export");
    const { branches } = run(w, target);
    expect(heads(target)).toEqual(["7.0.x", "embargoed/active/7.0.x"]);
    expect(git(target, "rev-parse", "7.0.x")).toBe(w.after);
    expect(git(target, "rev-parse", "embargoed/active/7.0.x")).toBe(w.before);
    expect(
      branches.map((b) => [b.repository, b.branch, b.changed, b.commits]),
    ).toEqual([
      ["oss", "7.0.x", true, 2],
      ["commercial", "embargoed/active/7.0.x", false, 0],
    ]);
    // the commit before is in it, so that the diff can be made
    expect(git(target, "diff", "--stat", w.before, "7.0.x")).toContain(
      "version.txt",
    );
    expect(git(target, "symbolic-ref", "HEAD")).toBe("refs/heads/7.0.x");
  });

  it("has no background maintenance, whose lock files break the upload", () => {
    const w = world();
    const target = path.join(w.root, "export");
    run(w, target);
    expect(git(target, "config", "--local", "gc.auto")).toBe("0");
    expect(git(target, "config", "--local", "maintenance.auto")).toBe("false");
  });

  it("has a README with the table and how to look, and no remote and no push", () => {
    const w = world();
    const target = path.join(w.root, "export");
    run(w, target);
    const readme = fs.readFileSync(path.join(target, "README.md"), "utf8");
    expect(readme).toContain(
      "# Code freeze of spring-security, release train 2026.11.19 (dry run)",
    );
    expect(readme).toContain(
      `| owner/spring-security | \`7.0.x\` | ${w.after.slice(0, 7)} | ${w.before.slice(0, 7)} | 2 |`,
    );
    expect(readme).toContain(
      `| owner/spring-security-commercial | \`embargoed/active/7.0.x\` | ${w.before.slice(0, 7)} | up to date | 0 |`,
    );
    expect(readme).toContain("git log --graph --oneline 7.0.x");
    expect(readme).toContain(
      `git log --oneline ${w.before.slice(0, 7)}..7.0.x`,
    );
    expect(readme).toContain(`git diff ${w.before.slice(0, 7)} 7.0.x`);
    expect(readme).not.toMatch(/git push/);
    expect(git(target, "remote")).toBe("");
  });

  it("exports nothing when the freeze changed no branch", () => {
    const w = world();
    const target = path.join(w.root, "export");
    expect(run(w, target, { apply: { branches: [] } })).toEqual({
      branches: [],
    });
    expect(fs.existsSync(target)).toBe(false);
  });

  it("fails if the directory is not empty, or a branch is in two repositories", () => {
    const w = world();
    const target = path.join(w.root, "export");
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "x"), "x");
    expect(() => run(w, target)).toThrow("exists, and is not empty");
    const twice = {
      branches: [
        w.apply.branches[0],
        { ...w.apply.branches[1], branch: "7.0.x" },
      ],
    };
    expect(() => run(w, path.join(w.root, "other"), { apply: twice })).toThrow(
      "is in the freeze of two repositories",
    );
  });
});

describe("the action", () => {
  it("exports from the files, with outputs and a summary", async () => {
    const w = world();
    const applyFile = path.join(w.root, "apply.json");
    const planFile = path.join(w.root, "plan.json");
    fs.writeFileSync(applyFile, JSON.stringify(w.apply));
    fs.writeFileSync(planFile, JSON.stringify(w.plan));
    const summary = path.join(w.root, "summary.md");
    const directory = path.join(w.root, "out");
    const result = await runAction(
      "src/index.js",
      {
        "apply-file": applyFile,
        "plan-file": planFile,
        directory,
        path: w.clone,
        "dry-run": "true",
      },
      { GITHUB_STEP_SUMMARY: summary },
    );
    expect(result.code).toBe(0);
    expect(result.outputs).toMatchObject({
      directory,
      name: "code-freeze-changes-2026.11.19",
      count: "2",
    });
    expect(heads(directory)).toEqual(["7.0.x", "embargoed/active/7.0.x"]);
    const text = fs.readFileSync(summary, "utf8");
    expect(text).toContain(
      "### Code freeze of spring-security, release train 2026.11.19 (dry run): the changes",
    );
    expect(text).toContain(
      "Download the artifact `code-freeze-changes-2026.11.19`, unzip it, and from inside it, for example:",
    );
  });
});
