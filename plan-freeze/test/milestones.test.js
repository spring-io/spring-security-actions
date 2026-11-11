import { describe, expect, it } from "vitest";
import { planMilestones } from "../src/milestones.js";

const OSS = "spring-projects/spring-security";
const HOST = "spring-projects/spring-security-commercial";

let numbers = 0;
const milestone = (title, due = "2026-11-19", state = "open") => ({
  title,
  state,
  due_on: due ? `${due}T12:00:00Z` : null,
  number: ++numbers,
  html_url: `https://github.com/x/y/milestone/${numbers}`,
  open_issues: 0,
  closed_issues: 0,
});

const milestoneOf = (milestones, repository, title) => {
  const found = milestones.find((m) => m.title === title);
  return (
    found && {
      repository,
      title,
      number: found.number,
      url: found.html_url,
      state: found.state,
      open: found.open_issues,
      closed: found.closed_issues,
    }
  );
};

function plan(options) {
  return planMilestones({
    generation: "7.0.x",
    candidate: "7.0.9",
    current: "7.0.9-SNAPSHOT",
    next: "7.0.10-SNAPSHOT",
    releaseVersion: "7.0.9",
    hotfix: "7.0.9.1",
    differs: true,
    ossMilestones: [],
    commercialMilestones: [],
    ossRepository: OSS,
    hostRepository: HOST,
    milestoneOf,
    ...options,
  });
}

describe("planMilestones, a freeze from a patch version", () => {
  const commercialMilestones = [
    milestone("7.0.9", null, "closed"),
    milestone("7.0.9.1"),
    milestone("7.0.10", null),
  ];

  it("closes the tracker of the next release, makes the milestones of the next cycle and links them", () => {
    const planned = plan({
      commercialMilestones,
      ossMilestones: [milestone("7.0.9")],
    });
    expect(planned.trackers.map((t) => t.version)).toEqual(["7.0.10"]);
    expect(planned.trackers[0]).toMatchObject({
      tracker: true,
      of: ["7.0.x"],
      milestone: { repository: HOST, title: "7.0.10" },
    });
    expect(planned.creates).toEqual([
      { repository: OSS, title: "7.0.10", exists: false },
      { repository: HOST, title: "7.0.10.1", exists: false },
      { repository: HOST, title: "7.0.11", exists: false },
    ]);
    expect(planned.links).toEqual([
      {
        repository: HOST,
        title: "7.0.10",
        ossRepository: OSS,
        ossTitle: "7.0.10",
      },
    ]);
    expect(planned.warnings).toEqual([]);
  });

  it("says that a milestone to make is there already", () => {
    const planned = plan({
      commercialMilestones: [...commercialMilestones, milestone("7.0.11")],
      ossMilestones: [milestone("7.0.9"), milestone("7.0.10")],
    });
    expect(planned.creates.map((c) => [c.title, c.exists])).toEqual([
      ["7.0.10", true],
      ["7.0.10.1", false],
      ["7.0.11", true],
    ]);
  });

  it("warns, and links nothing, if the tracker of the next release does not exist", () => {
    const planned = plan({
      commercialMilestones: [milestone("7.0.9.1")],
    });
    expect(planned.trackers).toEqual([]);
    expect(planned.links).toEqual([]);
    expect(planned.warnings).toEqual([
      `${HOST} has no milestone 7.0.10, which tracks the fixes of 7.0.x: there is nothing to close`,
    ]);
    expect(planned.creates.map((c) => c.title)).toEqual([
      "7.0.10",
      "7.0.10.1",
      "7.0.11",
    ]);
  });

  it("makes the milestone of a hotfix that is not made a tracker, without a warning if it is not there", () => {
    const withIt = plan({ commercialMilestones, differs: false });
    expect(withIt.trackers.map((t) => t.version)).toEqual([
      "7.0.9.1",
      "7.0.10",
    ]);
    const without = plan({
      commercialMilestones: [milestone("7.0.10")],
      differs: false,
    });
    expect(without.trackers.map((t) => t.version)).toEqual(["7.0.10"]);
    expect(without.warnings).toEqual([]);
  });

  it("leaves the milestone of a hotfix that is made to the release", () => {
    expect(
      plan({ commercialMilestones }).trackers.map((t) => t.version),
    ).not.toContain("7.0.9.1");
  });
});

describe("planMilestones, a freeze of the GA of a .0 version", () => {
  it("closes the tracker of 7.0.1 and makes the milestones of the next cycle", () => {
    const planned = plan({
      candidate: "7.0.0",
      current: "7.0.0-SNAPSHOT",
      next: "7.0.1-SNAPSHOT",
      releaseVersion: "7.0.0",
      hotfix: "7.0.0.1",
      commercialMilestones: [milestone("7.0.0.1"), milestone("7.0.1")],
    });
    expect(planned.trackers.map((t) => t.version)).toEqual(["7.0.1"]);
    expect(planned.creates.map((c) => [c.repository, c.title])).toEqual([
      [OSS, "7.0.1"],
      [HOST, "7.0.1.1"],
      [HOST, "7.0.2"],
    ]);
  });
});

describe("planMilestones, a freeze of a milestone or release candidate of a .0 version", () => {
  const base = {
    candidate: "7.0.0",
    current: "7.0.0-SNAPSHOT",
    next: "7.0.0-SNAPSHOT",
    hotfix: "",
    differs: true,
  };
  const oss = [
    milestone("7.0.0-M1", "2026-09-01"),
    milestone("7.0.0-RC1", "2026-10-01"),
    milestone("7.0.0", "2026-11-01"),
  ];

  it("closes the tracker after the one that is made, and makes the tracker after that, in commercial only", () => {
    const planned = plan({
      ...base,
      releaseVersion: "7.0.0-M1",
      ossMilestones: oss,
      commercialMilestones: [milestone("7.0.0-RC1", null)],
    });
    expect(planned.trackers.map((t) => t.version)).toEqual(["7.0.0-RC1"]);
    expect(planned.links).toEqual([
      {
        repository: HOST,
        title: "7.0.0-RC1",
        ossRepository: OSS,
        ossTitle: "7.0.0-RC1",
      },
    ]);
    expect(planned.creates).toEqual([
      {
        repository: HOST,
        title: "7.0.0",
        exists: false,
        description: `OSS milestone: ${oss[2].html_url}`,
      },
    ]);
    expect(planned.warnings).toEqual([]);
  });

  it("makes nothing in OSS, and no tracker when the last release candidate is made", () => {
    const planned = plan({
      ...base,
      releaseVersion: "7.0.0-RC1",
      ossMilestones: oss.slice(1),
      commercialMilestones: [milestone("7.0.0")],
    });
    expect(planned.trackers.map((t) => t.version)).toEqual(["7.0.0"]);
    expect(planned.creates).toEqual([]);
    expect(planned.creates.some((c) => c.repository === OSS)).toBe(false);
  });

  it("warns if no open milestone is left after the one that is made", () => {
    const planned = plan({
      ...base,
      releaseVersion: "7.0.0-M1",
      ossMilestones: oss.slice(0, 1),
    });
    expect(planned.trackers).toEqual([]);
    expect(planned.creates).toEqual([]);
    expect(planned.warnings).toEqual([
      expect.stringContaining("has no open milestone for 7.0.0 after 7.0.0-M1"),
    ]);
  });

  it("warns, and makes the later tracker all the same, if the commercial repository has no tracker to close", () => {
    const planned = plan({
      ...base,
      releaseVersion: "7.0.0-M1",
      ossMilestones: oss,
    });
    expect(planned.trackers).toEqual([]);
    expect(planned.warnings).toEqual([
      `${HOST} has no milestone 7.0.0-RC1, which tracks the fixes of 7.0.x: there is nothing to close`,
    ]);
    expect(planned.creates.map((c) => c.title)).toEqual(["7.0.0"]);
  });
});
