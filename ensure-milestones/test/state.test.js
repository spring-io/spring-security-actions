import { describe, expect, it } from "vitest";
import { candidateOf, openReleasesOf, wantedFor } from "../src/state.js";

const milestone = (title, due, state = "open") => ({
  title,
  state,
  due_on: due ? `${due}T00:00:00Z` : null,
});

const titles = (list) => list.map((m) => `${m.repository} ${m.title}`);

describe("wantedFor, a patch version", () => {
  it("is the state after a freeze from 7.0.9: the release before is done, the next one is made", () => {
    const wanted = wantedFor({ version: "7.0.10-SNAPSHOT" });
    expect(titles(wanted.close)).toEqual([
      "oss 7.0.9",
      "host 7.0.9.1",
      "host 7.0.10",
    ]);
    expect(titles(wanted.make)).toEqual([
      "oss 7.0.10",
      "host 7.0.10.1",
      "host 7.0.11",
    ]);
    expect(wanted.link).toEqual([{ title: "7.0.10" }]);
    expect(wanted.warnings).toEqual([]);
  });

  it("is the same for the version that the branch has before the freeze", () => {
    const wanted = wantedFor({ version: "7.0.9-SNAPSHOT" });
    expect(titles(wanted.close)).toEqual([
      "oss 7.0.8",
      "host 7.0.8.1",
      "host 7.0.9",
    ]);
    expect(titles(wanted.make)).toEqual([
      "oss 7.0.9",
      "host 7.0.9.1",
      "host 7.0.10",
    ]);
  });

  it("takes the GA as the release before the first patch", () => {
    const wanted = wantedFor({ version: "7.0.1-SNAPSHOT" });
    expect(titles(wanted.close)).toEqual([
      "oss 7.0.0",
      "host 7.0.0.1",
      "host 7.0.1",
    ]);
    expect(titles(wanted.make)).toEqual([
      "oss 7.0.1",
      "host 7.0.1.1",
      "host 7.0.2",
    ]);
  });
});

describe("wantedFor, a .0 version", () => {
  const milestones = [
    milestone("7.2.0-M1", "2026-09-01", "closed"),
    milestone("7.2.0-RC1", "2026-10-01"),
    milestone("7.2.0", "2026-11-01"),
  ];

  it("is the release candidate that is made next: its tracker is closed, the GA tracker is made, nothing in OSS", () => {
    const wanted = wantedFor({
      version: "7.2.0-SNAPSHOT",
      ossMilestones: milestones,
    });
    expect(titles(wanted.close)).toEqual(["host 7.2.0-RC1"]);
    expect(wanted.link).toEqual([{ title: "7.2.0-RC1" }]);
    expect(wanted.make).toEqual([
      { repository: "host", title: "7.2.0", link: true },
    ]);
    expect(wanted.make.some((m) => m.repository === "oss")).toBe(false);
  });

  it("takes a release that the freeze closes as closed", () => {
    // M1 was just made: the one after it is RC1, and the tracker of the one after that, the GA
    const wanted = wantedFor({
      version: "7.2.0-SNAPSHOT",
      ossMilestones: [
        milestone("7.2.0-M1", "2026-09-01"),
        milestone("7.2.0-RC1", "2026-10-01"),
        milestone("7.2.0", "2026-11-01"),
      ],
      closing: ["7.2.0-M1"],
    });
    expect(titles(wanted.close)).toEqual(["host 7.2.0-RC1"]);
    expect(wanted.make).toEqual([
      { repository: "host", title: "7.2.0", link: true },
    ]);
  });

  it("is a release like the others once the GA is the one that is made next", () => {
    const wanted = wantedFor({
      version: "7.2.0-SNAPSHOT",
      ossMilestones: [
        milestone("7.2.0-RC1", "2026-10-01", "closed"),
        milestone("7.2.0", "2026-11-01"),
      ],
    });
    expect(titles(wanted.close)).toEqual(["host 7.2.0"]);
    expect(titles(wanted.make)).toEqual([
      "oss 7.2.0",
      "host 7.2.0.1",
      "host 7.2.1",
    ]);
    expect(wanted.link).toEqual([{ title: "7.2.0" }]);
  });

  it("warns if no open milestone is left for it, or none after the one that is made", () => {
    expect(
      wantedFor({ version: "7.2.0-SNAPSHOT", ossMilestones: [] }).warnings,
    ).toEqual([expect.stringContaining("has no open milestone for 7.2.0")]);
    const last = wantedFor({
      version: "7.2.0-SNAPSHOT",
      ossMilestones: [milestone("7.2.0-RC1", "2026-10-01")],
    });
    expect(last.warnings).toEqual([expect.stringContaining("after 7.2.0-RC1")]);
    expect(titles(last.close)).toEqual(["host 7.2.0-RC1"]);
  });
});

describe("wantedFor, long-term support", () => {
  it("closes the release before it, in the commercial repository, and makes nothing", () => {
    const wanted = wantedFor({ version: "5.8.31-SNAPSHOT", lts: true });
    expect(titles(wanted.close)).toEqual(["host 5.8.30"]);
    expect(wanted.make).toEqual([]);
    expect(wanted.link).toEqual([]);
  });
});

describe("candidateOf and openReleasesOf", () => {
  it("drops -SNAPSHOT, and refuses what is not a snapshot of a release", () => {
    expect(candidateOf("7.0.10-SNAPSHOT")).toBe("7.0.10");
    expect(() => candidateOf("7.0.10")).toThrow(/not a snapshot/);
    expect(() => candidateOf("7.0.10.1-SNAPSHOT")).toThrow(/no release/);
  });

  it("orders the open milestones of a .0 version by due date, none last", () => {
    expect(
      openReleasesOf("7.2.0", [
        milestone("7.2.0", "2026-11-01"),
        milestone("7.2.0-M1", null),
        milestone("7.2.0-RC1", "2026-10-01"),
        milestone("7.2.0-M0", "2026-01-01", "closed"),
        milestone("7.2.1", "2026-01-01"),
      ]),
    ).toEqual(["7.2.0-RC1", "7.2.0", "7.2.0-M1"]);
  });
});
