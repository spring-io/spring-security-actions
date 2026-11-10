import { describe, expect, it } from "vitest";
import {
  candidateOf,
  hotfixOf,
  nextVersion,
  openReleasesOf,
  releaseVersionOf,
} from "../src/versions.js";

describe("nextVersion", () => {
  it.each([
    ["7.0.5-SNAPSHOT", "7.0.5", "7.0.6-SNAPSHOT"],
    ["7.0.9-SNAPSHOT", "7.0.9", "7.0.10-SNAPSHOT"],
    ["6.5.11-SNAPSHOT", "6.5.11", "6.5.12-SNAPSHOT"],
    ["7.0.5-SNAPSHOT", "", "7.0.6-SNAPSHOT"],
  ])("%s with the release %j is %s", (current, release, next) => {
    expect(nextVersion(current, release)).toBe(next);
  });

  it("keeps a .0 version while the release that is made is not the GA", () => {
    expect(nextVersion("7.2.0-SNAPSHOT", "7.2.0-M1")).toBe("7.2.0-SNAPSHOT");
    expect(nextVersion("7.2.0-SNAPSHOT", "7.2.0-RC1")).toBe("7.2.0-SNAPSHOT");
    expect(nextVersion("7.2.0-SNAPSHOT", "")).toBe("7.2.0-SNAPSHOT");
  });

  it("goes to .1 when the release that is made is the GA", () => {
    expect(nextVersion("7.2.0-SNAPSHOT", "7.2.0")).toBe("7.2.1-SNAPSHOT");
    expect(nextVersion("7.1.0-SNAPSHOT", "7.1.0")).toBe("7.1.1-SNAPSHOT");
  });

  it.each([["7.0.5"], ["7.0.5.1-SNAPSHOT"], ["7.1.0-RC1-SNAPSHOT"], [""]])(
    "refuses %j",
    (version) => {
      expect(() => nextVersion(version, "")).toThrow();
    },
  );
});

describe("candidateOf", () => {
  it("drops -SNAPSHOT", () => {
    expect(candidateOf("7.0.5-SNAPSHOT")).toBe("7.0.5");
  });
});

describe("releaseVersionOf", () => {
  const milestone = (title, due, state = "open") => ({
    title,
    state,
    due_on: due ? `${due}T00:00:00Z` : null,
  });

  it("is the version itself for a version that does not end with .0", () => {
    expect(releaseVersionOf("7.0.5", [])).toBe("7.0.5");
  });

  it("is the open milestone of a .0 version with the earliest due date", () => {
    const milestones = [
      milestone("7.2.0-M1", "2026-06-01", "closed"),
      milestone("7.2.0-M2", "2026-09-01"),
      milestone("7.2.0-M3", "2026-10-01"),
      milestone("7.2.0-RC1", "2026-11-01"),
      milestone("7.2.0", "2026-12-01"),
      milestone("7.2.1", "2027-01-01"),
    ];
    expect(releaseVersionOf("7.2.0", milestones)).toBe("7.2.0-M2");
  });

  it("orders the milestones that are due on one day, and puts one with no due date last", () => {
    expect(
      releaseVersionOf("7.2.0", [
        milestone("7.2.0", "2026-12-01"),
        milestone("7.2.0-RC1", "2026-12-01"),
        milestone("7.2.0-M3", "2026-12-01"),
        milestone("7.2.0-M2", null),
      ]),
    ).toBe("7.2.0-M3");
  });

  it("is empty for a .0 version with no open milestone", () => {
    expect(
      releaseVersionOf("7.2.0", [
        milestone("7.2.0-M1", "2026-06-01", "closed"),
      ]),
    ).toBe("");
  });
});

describe("openReleasesOf", () => {
  const milestone = (title, due, state = "open") => ({
    title,
    state,
    due_on: due ? `${due}T00:00:00Z` : null,
  });

  it("lists the open milestones of a .0 version in the order that they are released", () => {
    expect(
      openReleasesOf("7.2.0", [
        milestone("7.2.0", "2026-12-01"),
        milestone("7.2.0-M1", "2026-06-01", "closed"),
        milestone("7.2.0-RC1", "2026-11-01"),
        milestone("7.2.0-M2", "2026-09-01"),
        milestone("7.2.0.1", "2026-12-24"),
        milestone("7.2.1", "2027-01-01"),
        milestone("7.2.01", "2026-01-01"),
      ]),
    ).toEqual(["7.2.0-M2", "7.2.0-RC1", "7.2.0"]);
  });

  it("is empty if no milestone is open", () => {
    expect(openReleasesOf("7.2.0", [])).toEqual([]);
  });
});

describe("hotfixOf", () => {
  it("is the release and .1", () => {
    expect(hotfixOf("7.0.5", "7.0.5")).toBe("7.0.5.1");
  });

  it("is only for the GA of a .0 version", () => {
    expect(hotfixOf("7.2.0", "7.2.0-RC1")).toBe("");
    expect(hotfixOf("7.2.0", "7.2.0")).toBe("7.2.0.1");
    expect(hotfixOf("7.2.0", "")).toBe("");
  });
});
