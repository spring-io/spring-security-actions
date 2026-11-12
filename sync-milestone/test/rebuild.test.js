import { describe, expect, it } from "vitest";
import { discover, rebuildReleases } from "../src/rebuild.js";
import {
  HOST,
  OSS,
  TRAINS,
  fakeGitHub,
  milestone,
  trainYaml,
} from "./support/fake.js";

const due = (date) => `${date}T00:00:00Z`;
const common = {
  repositories: { oss: OSS, host: HOST },
  project: "spring-security",
  trainRepository: TRAINS,
};
const timing = { sleep: async () => {}, intervalMs: 0 };

/**
 * Two generations of the commercial repository, 7.0.x (7.0.10, due on the train 2026.12.17)
 * and main (7.2.0, a milestone of a .0 version), and a long-term support branch, 5.8.x.
 */
function project(options = {}) {
  const github = fakeGitHub({
    milestones: {
      [OSS]: [
        milestone(OSS, "7.0.10", { due_on: due("2026-12-17") }),
        milestone(OSS, "7.2.0-RC1", { due_on: due("2026-11-19") }),
        milestone(OSS, "7.2.0", { due_on: due("2026-12-17") }),
      ],
      [HOST]: [
        milestone(HOST, "5.8.31", {
          description: "Release Train: 2026.12.17",
        }),
      ],
    },
    versions: {
      "embargoed/frozen/7.0.x": "7.0.10-SNAPSHOT",
      "embargoed/active/7.0.x": "7.0.10-SNAPSHOT",
      "embargoed/frozen/main": "7.2.0-SNAPSHOT",
      "embargoed/active/main": "7.2.0-SNAPSHOT",
      "embargoed/lts/5.8.x": "5.8.31-SNAPSHOT",
    },
    trains: {
      "2026.12.17": trainYaml({ availability: "2027-01-21" }),
      "2026.11.19": trainYaml({ availability: "2026-12-17" }),
    },
    ...options,
  });
  return github;
}

const refs = (github) => github.dispatches.map((d) => d.ref);

describe("discover", () => {
  it("finds the release that each embargoed branch builds, and the train it is due in", async () => {
    const { items } = await discover(project(), { oss: OSS, host: HOST });
    expect(items.map((i) => [i.kind, i.branch, i.release, i.train])).toEqual([
      ["frozen", "embargoed/frozen/7.0.x", "7.0.10", "2026.12.17"],
      // the release of a .0 version is its open milestone with the earliest due date
      ["frozen", "embargoed/frozen/main", "7.2.0-RC1", "2026.11.19"],
      ["active", "embargoed/active/7.0.x", "7.0.10.1", "2026.12.17"],
      ["lts", "embargoed/lts/5.8.x", "5.8.31", "2026.12.17"],
    ]);
  });

  it("has no hotfix for a milestone or a release candidate, and one for the GA", async () => {
    const github = project();
    const releases = (await discover(github, { oss: OSS, host: HOST })).items
      .filter((i) => i.kind === "active")
      .map((i) => i.release);
    expect(releases).toEqual(["7.0.10.1"]);
    // 7.2.0-RC1 is closed: the GA is the release now, and has a hotfix
    github.milestones[OSS].find((m) => m.title === "7.2.0-RC1").state =
      "closed";
    const later = (await discover(github, { oss: OSS, host: HOST })).items
      .filter((i) => i.kind === "active")
      .map((i) => i.release);
    expect(later).toEqual(["7.0.10.1", "7.2.0.1"]);
  });

  it("has no train for a milestone that has no due date and no line", async () => {
    const github = project();
    github.milestones[OSS].find((m) => m.title === "7.0.10").due_on = null;
    const { items } = await discover(github, { oss: OSS, host: HOST });
    expect(items.find((i) => i.release === "7.0.10").train).toBe("");
    expect(items.find((i) => i.release === "7.0.10.1").train).toBe("");
  });

  it("says why it leaves a branch out", async () => {
    const github = project({
      versions: {
        "embargoed/frozen/7.0.x": "7.0.10-SNAPSHOT",
        "embargoed/active/main": "7.2.0-SNAPSHOT",
        "embargoed/lts/5.7.x": "oops",
      },
    });
    const { notes } = await discover(github, { oss: OSS, host: HOST });
    expect(notes).toEqual([
      "embargoed/active/main has no frozen branch to take its release from",
      "embargoed/lts/5.7.x has no release version (oops)",
    ]);
  });
});

describe("rebuildReleases", () => {
  it("builds the frozen and the long-term support branches first, and the active ones after them", async () => {
    const github = project();
    const { results } = await rebuildReleases(common, {
      octokit: github,
      ...timing,
    });
    const order = refs(github);
    expect(order.slice(0, 3).sort()).toEqual([
      "embargoed/frozen/7.0.x",
      "embargoed/frozen/main",
      "embargoed/lts/5.8.x",
    ]);
    expect(order[3]).toBe("embargoed/active/7.0.x");
    expect(order).toHaveLength(4);
    expect(
      github.dispatches.every((d) => d.workflow === "release-branches.yml"),
    ).toBe(true);
    expect(results.map((r) => r.result)).toEqual([
      "rebuilt",
      "rebuilt",
      "rebuilt",
      "rebuilt",
    ]);
  });

  it("builds a release that has no train, so that it is tested and its snapshot is published", async () => {
    const github = project();
    for (const title of ["7.0.10", "7.2.0", "7.2.0-RC1"]) {
      github.milestones[OSS].find((m) => m.title === title).due_on = null;
    }
    const { results } = await rebuildReleases(common, {
      octokit: github,
      ...timing,
    });
    expect(results.filter((r) => r.result === "rebuilt")).toHaveLength(4);
  });

  it("skips a release that is ready in its train", async () => {
    const github = project({
      trains: {
        "2026.12.17": trainYaml({
          availability: "2027-01-21",
          joined: ["7.0.10", "5.8.31"],
          ready: ["7.0.10"],
        }),
        "2026.11.19": trainYaml({ availability: "2026-12-17" }),
      },
    });
    const { results } = await rebuildReleases(common, {
      octokit: github,
      ...timing,
    });
    expect(
      results.filter((r) => r.result === "skipped").map((r) => r.release),
    ).toEqual(["7.0.10"]);
    expect(refs(github)).not.toContain("embargoed/frozen/7.0.x");
    // its hotfix is another release of the train, not ready
    expect(refs(github)).toContain("embargoed/active/7.0.x");
  });

  it.each(["in_progress", "queued"])(
    "rebuilds nothing while the code freeze is %s",
    async (status) => {
      const github = project({ freezeRuns: [status] });
      const { results, skipped } = await rebuildReleases(common, {
        octokit: github,
        ...timing,
      });
      expect(skipped).toBe("freeze");
      expect(results).toEqual([]);
      expect(github.dispatches).toEqual([]);
    },
  );

  it("rebuilds when the repository has no code freeze workflow", async () => {
    const github = project({ freezeRuns: null });
    const { results } = await rebuildReleases(common, {
      octokit: github,
      ...timing,
    });
    expect(results.filter((r) => r.result === "rebuilt")).toHaveLength(4);
  });

  it("starts nothing in a dry run, and says what it would do", async () => {
    const github = project();
    const { results } = await rebuildReleases(
      { ...common, dryRun: true },
      { octokit: github, ...timing },
    );
    expect(github.dispatches).toEqual([]);
    expect(results.map((r) => r.result)).toEqual([
      "would rebuild",
      "would rebuild",
      "would rebuild",
      "would rebuild",
    ]);
  });

  it("builds only the releases that it is told to", async () => {
    const github = project();
    await rebuildReleases(
      { ...common, only: ["7.0.10", "7.0.10.1"] },
      { octokit: github, ...timing },
    );
    expect(refs(github)).toEqual([
      "embargoed/frozen/7.0.x",
      "embargoed/active/7.0.x",
    ]);
  });

  it("says that a branch has no release workflow, and goes on", async () => {
    const github = project({ noWorkflow: ["embargoed/lts/5.8.x"] });
    const { results } = await rebuildReleases(common, {
      octokit: github,
      ...timing,
    });
    expect(
      results.find((r) => r.branch === "embargoed/lts/5.8.x"),
    ).toMatchObject({
      result: "skipped",
      reason: expect.stringContaining("is not on"),
    });
    expect(refs(github)).toContain("embargoed/active/7.0.x");
  });

  it("records a run that fails, and goes on with the others", async () => {
    const github = project({ failing: ["embargoed/frozen/7.0.x"] });
    const { results } = await rebuildReleases(common, {
      octokit: github,
      ...timing,
    });
    expect(results.filter((r) => r.result === "failed")).toEqual([
      expect.objectContaining({ branch: "embargoed/frozen/7.0.x" }),
    ]);
    expect(results.filter((r) => r.result === "rebuilt")).toHaveLength(3);
  });
});
