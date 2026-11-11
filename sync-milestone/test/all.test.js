import { describe, expect, it } from "vitest";
import { renderAll } from "../src/index.js";
import { syncAll, syncMilestone } from "../src/sync.js";
import {
  HOST,
  OSS,
  TRAINS,
  fakeGitHub,
  milestone,
  trainYaml,
} from "./support/fake.js";

const due = (date) => `${date}T00:00:00Z`;
const common = { project: "spring-security", trainRepository: TRAINS };

/**
 * A project the way it is before the first sync: OSS 7.0.9 and 7.1.3, due on the train 2026.11.19,
 * with nothing in their descriptions, their mirrors, hotfixes, and a trackers, a long-term
 * support milestone that has its line, and the ones that are not touched.
 */
function project({ joined = true } = {}) {
  const oss = {
    "7.0.9": milestone(OSS, "7.0.9", { due_on: due("2026-11-19") }),
    "7.1.3": milestone(OSS, "7.1.3", { due_on: due("2026-11-19") }),
    old: milestone(OSS, "7.0.8", {
      state: "closed",
      due_on: due("2026-10-22"),
    }),
    branch: milestone(OSS, "7.0.x"),
    // open, and never in a train: no due date, no line
    undated: milestone(OSS, "7.0.11"),
  };
  const host = {
    m709: milestone(HOST, "7.0.9", { due_on: "2026-11-19T12:00:00Z" }),
    h709: milestone(HOST, "7.0.9.1", { due_on: "2026-12-17T12:00:00Z" }),
    m713: milestone(HOST, "7.1.3", { due_on: "2026-11-19T12:00:00Z" }),
    h713: milestone(HOST, "7.1.3.1"),
    tracker: milestone(HOST, "7.0.10", { due_on: "2026-12-17T12:00:00Z" }),
    lts: milestone(HOST, "5.8.30", {
      due_on: "2026-12-17T12:00:00Z",
      description: "Release Train: 2026.11.19",
    }),
    ltsOld: milestone(HOST, "5.8.29", { state: "closed" }),
    other: milestone(HOST, "6.4.21"),
  };
  const github = fakeGitHub({
    milestones: { [OSS]: Object.values(oss), [HOST]: Object.values(host) },
    branches: [
      "release/7.0.9",
      "release/7.0.9.1",
      "release/7.1.3",
      "release/7.1.3.1",
      "release/5.8.30",
      "embargoed/lts/5.8.x",
    ],
    versions: {
      "embargoed/frozen/7.0.x": "7.0.9-SNAPSHOT",
      "embargoed/active/7.0.x": "7.0.9-SNAPSHOT",
      "embargoed/frozen/7.1.x": "7.1.3-SNAPSHOT",
      "embargoed/active/7.1.x": "7.1.3-SNAPSHOT",
      "embargoed/lts/5.8.x": "5.8.30-SNAPSHOT",
    },
    trains: {
      "2026.10.22": trainYaml({ joined: ["7.0.9", "7.0.9.1"] }),
      "2026.11.19": trainYaml({
        availability: "2026-12-17",
        joined: joined
          ? ["7.0.9", "7.0.9.1", "7.1.3", "7.1.3.1", "5.8.30"]
          : [],
      }),
    },
  });
  return { github, oss, host };
}

describe("a dry run of one milestone", () => {
  it("writes nothing and starts nothing, and says what it would do", async () => {
    const { github, oss } = project({ joined: false });
    const { actions, events } = await syncMilestone(
      {
        repository: OSS,
        milestone: "7.0.9",
        changes: { due_on: { from: "2026-10-22T00:00:00Z" } },
        dryRun: true,
        ...common,
      },
      { octokit: github },
    );
    expect(github.updates).toEqual([]);
    expect(github.dispatches).toEqual([]);
    expect(oss["7.0.9"].description).toBe("");
    expect(actions.join("\n")).toMatch(/would change .*7\.0\.9/);
    expect(actions.join("\n")).toMatch(/would be rebuilt/);
    expect(events.filter((e) => e.type === "rebuild")).toHaveLength(2);
  });

  it("does what it said when it is not a dry run", async () => {
    const options = {
      repository: OSS,
      milestone: "7.0.9",
      changes: { due_on: { from: "2026-10-22T00:00:00Z" } },
      ...common,
    };
    const dry = await syncMilestone(
      { ...options, dryRun: true },
      { octokit: project({ joined: false }).github },
    );
    const { github } = project({ joined: false });
    const real = await syncMilestone(options, {
      octokit: github,
      sleep: async () => {},
      intervalMs: 0,
    });
    expect(real.events.map((e) => e.type)).toEqual(
      dry.events.map((e) => e.type),
    );
    // it leaves the train of the old date, and builds the branches again to join the new one
    expect(github.dispatches.map((d) => d.ref)).toEqual([
      "release/7.0.9",
      "release/7.0.9.1",
      "embargoed/frozen/7.0.x",
      "embargoed/active/7.0.x",
    ]);
  });
});

describe("syncAll", () => {
  it("syncs the open OSS milestones of releases, with their mirrors and hotfixes, and the long-term support ones", async () => {
    const { github } = project();
    const { results, totals } = await syncAll(
      { repository: OSS, dryRun: true, ...common },
      { octokit: github },
    );
    expect(
      results.map((r) => `${r.repository === OSS ? "oss" : "host"} ${r.title}`),
    ).toEqual(["oss 7.0.9", "oss 7.1.3", "host 5.8.30"]);
    expect(github.updates).toEqual([]);
    expect(github.dispatches).toEqual([]);
    // the OSS milestone, the mirror and the hotfix of each of the two releases
    expect(totals).toEqual({
      milestones: 3,
      descriptions: 6,
      dueDates: 1,
      leaves: 0,
      rebuilds: 0,
    });
  });

  it("leaves alone the closed milestones, the trackers, and what is not a release", async () => {
    const { github } = project();
    const { results } = await syncAll(
      { repository: OSS, dryRun: true, ...common },
      { octokit: github },
    );
    const titles = results.map((r) => r.title);
    // 6.4.21 has no line and no long-term support branch: it is not one
    for (const left of [
      "7.0.8",
      "7.0.x",
      "7.0.10",
      "5.8.29",
      "7.0.9.1",
      "6.4.21",
      "7.0.11",
    ]) {
      expect(titles).not.toContain(left);
    }
  });

  it("syncs an OSS milestone whose due date was cleared, if its description still has the line", async () => {
    const { github, oss, host } = project();
    oss["7.0.9"].due_on = null;
    oss["7.0.9"].description = "Release Train: 2026.11.19";
    const { results } = await syncAll(
      { repository: OSS, dryRun: true, ...common },
      { octokit: github },
    );
    expect(results.map((r) => r.title)).toContain("7.0.9");
    // the commercial milestones of a milestone that is skipped are not touched
    const skipped = await syncAll(
      { repository: OSS, dryRun: true, ...common },
      { octokit: project().github },
    );
    expect(skipped.results.map((r) => r.title)).not.toContain("7.0.11");
    expect(host.lts.title).toBe("5.8.30");
  });

  it("is the same from the commercial repository", async () => {
    const a = await syncAll(
      { repository: OSS, dryRun: true, ...common },
      { octokit: project().github },
    );
    const b = await syncAll(
      { repository: HOST, dryRun: true, ...common },
      { octokit: project().github },
    );
    expect(b.totals).toEqual(a.totals);
  });

  it("writes it for real, and a second run has nothing to change", async () => {
    const { github, oss, host } = project();
    const first = await syncAll(
      { repository: OSS, ...common },
      { octokit: github },
    );
    expect(first.totals.descriptions).toBe(6);
    expect(oss["7.0.9"].description).toBe("Release Train: 2026.11.19");
    expect(host.h709.description).toBe("Release Train: 2026.11.19");
    expect(host.m709.description).toMatch(
      /^Release Train: 2026\.11\.19\nOSS milestone: /,
    );
    expect(host.h713.due_on).toBe("2026-12-17T12:00:00Z");
    const second = await syncAll(
      { repository: OSS, ...common },
      { octokit: github },
    );
    expect(second.totals).toEqual({
      milestones: 3,
      descriptions: 0,
      dueDates: 0,
      leaves: 0,
      rebuilds: 0,
    });
  });

  it("leaves the train that a description names, when it is not the one of the due date, and counts it", async () => {
    const { github, oss } = project();
    oss["7.0.9"].description = "Release Train: 2026.10.22";
    const { totals } = await syncAll(
      { repository: OSS, ...common },
      { octokit: github },
    );
    expect(totals.leaves).toBe(2);
    expect(github.dispatches.map((d) => d.workflow)).toEqual([
      "release-train-leave.yml",
      "release-train-leave.yml",
    ]);
  });

  it("does not start a rebuild: the nightly run does that for all the branches", async () => {
    const { github } = project({ joined: false });
    const { totals } = await syncAll(
      { repository: OSS, ...common },
      { octokit: github },
    );
    expect(totals.rebuilds).toBe(0);
    expect(github.dispatches).toEqual([]);
  });

  it("starts nothing with dispatch false", async () => {
    const { github, oss } = project();
    oss["7.0.9"].description = "Release Train: 2026.10.22";
    const { totals } = await syncAll(
      { repository: OSS, dispatch: false, ...common },
      { octokit: github },
    );
    expect(totals.leaves).toBe(0);
    expect(github.dispatches).toEqual([]);
  });
});

describe("renderAll", () => {
  it("says that it is a dry run, what each milestone would do, and the totals", async () => {
    const { github } = project();
    const { results, totals } = await syncAll(
      { repository: OSS, dryRun: true, ...common },
      { octokit: github },
    );
    const markdown = renderAll({
      repository: OSS,
      dryRun: true,
      results,
      totals,
    });
    expect(markdown).toContain(
      `# Sync of all the milestones of ${OSS}     DRY RUN`,
    );
    expect(markdown).toContain(`## ${OSS} 7.0.9`);
    expect(markdown).toContain("- would change");
    expect(markdown).toContain("- nothing to change");
    expect(markdown).toContain(
      "**Totals:** 3 milestones looked at. 6 descriptions would change, 1 due date, 0 releases would leave a train.",
    );
  });

  it("says did, and not would, for a real run", () => {
    const markdown = renderAll({
      repository: OSS,
      dryRun: false,
      results: [],
      totals: {
        milestones: 0,
        descriptions: 1,
        dueDates: 0,
        leaves: 1,
        rebuilds: 0,
      },
      rebuilds: [
        {
          branch: "embargoed/frozen/7.0.x",
          release: "7.0.10",
          result: "rebuilt",
          reason: "https://github.com/x/y/actions/runs/1",
        },
      ],
    });
    expect(markdown).not.toContain("DRY RUN");
    expect(markdown).toContain("1 description did change");
    expect(markdown).toContain(
      "1 release did leave a train, 1 branch were rebuilt.",
    );
    expect(markdown).toContain("## Rebuilds of the release branches");
    expect(markdown).toContain(
      "- embargoed/frozen/7.0.x (7.0.10): rebuilt, https://github.com/x/y/actions/runs/1",
    );
  });
});
