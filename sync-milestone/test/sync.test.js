import { describe, expect, it } from "vitest";
import { syncMilestone } from "../src/sync.js";
import {
  HOST,
  OSS,
  TRAINS,
  fakeGitHub,
  milestone,
  trainYaml,
} from "./support/fake.js";

const due = (date) => `${date}T00:00:00Z`;
// the previous due date of an edit is in the time zone of the editor, as GitHub sends it: this
// is 2026-11-19T00:00:00Z, and its first ten characters are the day before
const from = "2026-11-18T18:00:00.000-06:00";

const FROZEN = "embargoed/frozen/7.0.x";
const ACTIVE = "embargoed/active/7.0.x";

/** The OSS milestone 7.0.9 (due 2026-11-19), its commercial milestone, and the hotfix. */
function world({
  ossDue = "2026-11-19",
  trains,
  hotfix = true,
  user,
  freezeRuns,
  failing,
} = {}) {
  const oss = milestone(OSS, "7.0.9", {
    due_on: ossDue ? due(ossDue) : null,
    description: "Notes of the release",
  });
  const mirror = milestone(HOST, "7.0.9", { state: "closed" });
  const fix = milestone(HOST, "7.0.9.1");
  const github = fakeGitHub({
    milestones: {
      [OSS]: [oss],
      [HOST]: hotfix ? [mirror, fix] : [mirror],
    },
    branches: ["release/7.0.9", "release/7.0.9.1"],
    versions: {
      [FROZEN]: "7.0.9-SNAPSHOT",
      [ACTIVE]: "7.0.9-SNAPSHOT",
      "embargoed/lts/5.8.x": "5.8.30-SNAPSHOT",
    },
    trains: trains ?? {
      "2026.11.19": trainYaml({ availability: "2026-12-24" }),
      "2026.12.17": trainYaml({ availability: "2027-01-21" }),
    },
    user,
    freezeRuns,
    failing,
  });
  const sync = (options) =>
    syncMilestone(
      {
        repository: OSS,
        milestone: "7.0.9",
        project: "spring-security",
        trainRepository: TRAINS,
        ...options,
      },
      { octokit: github, sleep: async () => {}, intervalMs: 0 },
    );
  return { github, oss, mirror, fix, sync };
}

const joinedBoth = {
  "2026.11.19": trainYaml({
    availability: "2026-12-24",
    joined: ["7.0.9", "7.0.9.1"],
  }),
  "2026.12.17": trainYaml({ availability: "2027-01-21" }),
};
// in the train of the old date, and not in the one of the new date
const joinedInOld = {
  "2026.11.19": trainYaml({ joined: ["7.0.9", "7.0.9.1"] }),
  "2026.12.17": trainYaml({ availability: "2027-01-21" }),
};

const dispatched = (github) =>
  github.dispatches.map((d) =>
    d.workflow === "release-branches.yml"
      ? `rebuild ${d.ref}`
      : `${d.workflow.replace("release-train-", "").replace(".yml", "")} ${d.ref}`,
  );

describe("an OSS milestone with a due date", () => {
  it("has the line of a release that the train says has joined, and the milestones follow", async () => {
    const { github, oss, mirror, fix, sync } = world({ trains: joinedBoth });
    await sync({ changes: { due_on: { from: "" } } });
    expect(oss.description).toBe(
      "Release Train: 2026.11.19\nNotes of the release",
    );
    expect(mirror.due_on).toBe("2026-11-19T12:00:00Z");
    expect(mirror.description).toBe(
      `Release Train: 2026.11.19\nOSS milestone: ${oss.html_url}`,
    );
    expect(fix.due_on).toBe("2026-12-24T12:00:00Z");
    expect(fix.description).toBe("Release Train: 2026.11.19");
    // nothing to join, and nothing to rebuild: it joined
    expect(github.dispatches).toEqual([]);
  });

  it("has no line for a release that has not joined, and joins nothing itself", async () => {
    const { github, oss, mirror, fix, sync } = world();
    await sync({});
    expect(oss.description).toBe("Notes of the release");
    expect(mirror.due_on).toBe("2026-11-19T12:00:00Z");
    expect(fix.due_on).toBe("2026-12-24T12:00:00Z");
    expect(fix.description).toBe("");
    // a run by hand builds the release again: the dependencies of its train may have changed
    expect(dispatched(github)).toEqual([
      `rebuild ${FROZEN}`,
      `rebuild ${ACTIVE}`,
    ]);
  });

  it("starts the release workflow when the due date was set, so that the release joins", async () => {
    const { github, oss, sync } = world();
    await sync({ changes: { due_on: { from: "" } } });
    // the frozen branch first, and the active one after it
    expect(dispatched(github)).toEqual([
      `rebuild ${FROZEN}`,
      `rebuild ${ACTIVE}`,
    ]);
    expect(github.dispatches[0]).toEqual({
      repository: HOST,
      workflow: "release-branches.yml",
      ref: FROZEN,
      inputs: undefined,
    });
    // the line is written by the release workflow, once it has joined
    expect(oss.description).toBe("Notes of the release");
  });

  it("does not start it for a release that joined already", async () => {
    const { github, sync } = world({ trains: joinedBoth });
    await sync({ changes: { due_on: { from } } });
    expect(github.dispatches).toEqual([]);
  });

  it("makes no edit the second time", async () => {
    const { github, sync } = world({ trains: joinedBoth });
    await sync({ changes: { due_on: { from: "" } } });
    const edits = github.updates.length;
    const { actions } = await sync({ changes: { due_on: { from: "" } } });
    expect(github.updates).toHaveLength(edits);
    expect(actions).toEqual([]);
  });

  it("leaves a hotfix alone if its milestone does not exist", async () => {
    const { github, sync } = world({ hotfix: false, trains: joinedBoth });
    await sync({});
    expect(dispatched(github)).toEqual([`rebuild ${FROZEN}`]);
  });

  it("says why it builds a release again: the train changed, or a person asked", async () => {
    const changed = world();
    const { actions: byEdit } = await changed.sync({
      changes: { due_on: { from: "" } },
      dryRun: true,
    });
    expect(byEdit.join("\n")).toContain(
      `${FROZEN} (7.0.9): would be rebuilt (train changed)`,
    );
    const asked = world();
    const { actions: byHand } = await asked.sync({ dryRun: true });
    expect(byHand.join("\n")).toContain(
      `${FROZEN} (7.0.9): would be rebuilt (requested)`,
    );
    expect(asked.github.dispatches).toEqual([]);
  });

  it("builds nothing again for an edit that did not change the train", async () => {
    const { github, sync } = world({ trains: joinedBoth });
    await sync({ changes: { description: { from: "Old notes" } } });
    expect(github.dispatches).toEqual([]);
  });

  it("writes the lines without running anything with dispatch false, as for a release that has just joined", async () => {
    const { github, oss, fix, sync } = world();
    await sync({ dispatch: false, changes: { due_on: { from: "" } } });
    expect(github.dispatches).toEqual([]);
    expect(oss.description).toBe(
      "Release Train: 2026.11.19\nNotes of the release",
    );
    expect(fix.description).toBe("Release Train: 2026.11.19");
  });

  it("writes no error for a release branch that does not exist: it is not built, and so not joined", async () => {
    const { oss, fix, sync } = world();
    fix.description = "";
    await sync({});
    expect(oss.description).not.toMatch(/ERROR/);
    expect(fix.description).toBe("");
  });
});

describe("a due date with no release train", () => {
  it("is kept, without a line, and nothing is started", async () => {
    const { github, oss, mirror, fix, sync } = world({ ossDue: "2026-12-31" });
    oss.description = "Release Train: 2026.11.19\nNotes of the release";
    fix.due_on = "2026-12-24T12:00:00Z";
    await sync({ changes: { due_on: { from } } });
    expect(oss.due_on).toBe(due("2026-12-31"));
    expect(oss.description).toBe("Notes of the release");
    expect(mirror.due_on).toBe("2026-12-31T12:00:00Z");
    // the due date of the hotfix comes from the train, which is not there: it is left
    expect(fix.due_on).toBe("2026-12-24T12:00:00Z");
    expect(fix.description).toBe("");
    expect(github.dispatches).toEqual([]);
  });

  it("still leaves the train that the release was in", async () => {
    const { github, oss, sync } = world({
      ossDue: "2026-12-31",
      trains: joinedInOld,
    });
    await sync({ changes: { due_on: { from } } });
    expect(dispatched(github)).toEqual([
      "leave release/7.0.9",
      "leave release/7.0.9.1",
    ]);
    expect(oss.due_on).toBe(due("2026-12-31"));
  });

  it("gets its line later, once the train exists and the release has joined", async () => {
    const { oss, sync } = world({
      ossDue: "2026-12-17",
      trains: {
        "2026.12.17": trainYaml({
          availability: "2027-01-21",
          joined: ["7.0.9", "7.0.9.1"],
        }),
      },
    });
    await sync({});
    expect(oss.description).toBe(
      "Release Train: 2026.12.17\nNotes of the release",
    );
  });
});

describe("the due date of an OSS milestone changes", () => {
  it("leaves the train that it was in, and starts the release workflow to join the new one", async () => {
    const { github, oss, mirror, fix, sync } = world({
      ossDue: "2026-12-17",
      trains: joinedInOld,
    });
    oss.description = "Release Train: 2026.11.19\nNotes of the release";
    await sync({ changes: { due_on: { from } } });
    expect(dispatched(github)).toEqual([
      "leave release/7.0.9",
      "leave release/7.0.9.1",
      `rebuild ${FROZEN}`,
      `rebuild ${ACTIVE}`,
    ]);
    expect(github.dispatches[0].inputs).toEqual({
      "release-train": "2026.11.19",
      "release-train-repository": TRAINS,
    });
    // the old line is gone, and the new one comes with the join
    expect(oss.description).toBe("Notes of the release");
    expect(mirror.due_on).toBe("2026-12-17T12:00:00Z");
    expect(fix.due_on).toBe("2027-01-21T12:00:00Z");
  });

  it("reads the previous due date as an instant, as GitHub sends it", async () => {
    for (const previous of [
      from,
      "2026-11-19T09:00:00.000+09:00",
      "2026-11-18T19:00:00.000-05:00",
      "2026-11-19T00:00:00Z",
    ]) {
      const { github, sync } = world({
        ossDue: "2026-12-17",
        trains: joinedInOld,
      });
      await sync({ changes: { due_on: { from: previous } } });
      expect(github.dispatches[0].inputs["release-train"]).toBe("2026.11.19");
    }
  });

  it("finds the train to leave in the description when the previous date is not known", async () => {
    const { github, oss, sync } = world({
      ossDue: "2026-12-17",
      trains: joinedInOld,
    });
    oss.description = "Release Train: 2026.11.19\nNotes of the release";
    await sync({});
    expect(dispatched(github).slice(0, 2)).toEqual([
      "leave release/7.0.9",
      "leave release/7.0.9.1",
    ]);
  });

  it("does not leave a train that the release did not join", async () => {
    const { github, sync } = world({
      ossDue: "2026-12-17",
      trains: {
        "2026.11.19": trainYaml({}),
        "2026.12.17": trainYaml({ availability: "2027-01-21" }),
      },
    });
    await sync({ changes: { due_on: { from } } });
    expect(dispatched(github).filter((d) => d.startsWith("leave"))).toEqual([]);
  });

  it("takes the line out, and leaves the train, if the due date is cleared", async () => {
    const { github, oss, mirror, fix, sync } = world({
      ossDue: "",
      trains: joinedInOld,
    });
    oss.description = "Release Train: 2026.11.19\nNotes of the release";
    mirror.due_on = due("2026-11-19");
    fix.due_on = due("2026-12-24");
    fix.description = "Release Train: 2026.11.19";
    await sync({ changes: { due_on: { from } } });
    expect(dispatched(github)).toEqual([
      "leave release/7.0.9",
      "leave release/7.0.9.1",
    ]);
    expect(oss.description).toBe("Notes of the release");
    expect(mirror.due_on).toBeNull();
    expect(fix.due_on).toBeNull();
    expect(fix.description).toBe("");
  });

  it("changes nothing, and says why, if the train is ready", async () => {
    const { github, oss, mirror, fix, sync } = world({
      ossDue: "2026-12-17",
      trains: {
        "2026.11.19": trainYaml({
          joined: ["7.0.9", "7.0.9.1"],
          ready: ["7.0.9"],
        }),
        "2026.12.17": trainYaml({}),
      },
    });
    await sync({ changes: { due_on: { from } } });
    expect(github.dispatches).toEqual([]);
    expect(oss.description).toBe(
      "ERROR: Cannot leave the Release Train 2026.11.19: it is ready\nNotes of the release",
    );
    expect(fix.description).toBe(
      "ERROR: Cannot leave the Release Train 2026.11.19: it is ready",
    );
    expect(oss.due_on).toBe(due("2026-12-17"));
    expect(mirror.due_on).toBeNull();
  });

  it("fails if the release workflow fails, and says on which branch", async () => {
    const { sync } = world({
      ossDue: "2026-12-17",
      trains: joinedInOld,
      failing: [FROZEN],
    });
    await expect(sync({ changes: { due_on: { from } } })).rejects.toThrow(
      new RegExp(`${FROZEN}.*failure`),
    );
  });

  it("does not start the release workflow in a dry run, and says that it would", async () => {
    const { github, sync } = world({
      ossDue: "2026-12-17",
      trains: joinedInOld,
    });
    const { actions, events } = await sync({
      changes: { due_on: { from } },
      dryRun: true,
    });
    expect(github.dispatches).toEqual([]);
    expect(github.updates).toEqual([]);
    expect(actions.join("\n")).toMatch(/would be rebuilt/);
    expect(events.filter((e) => e.type === "rebuild")).toHaveLength(2);
  });

  it("does not start it for an edit that only changes the description", async () => {
    const { github, sync } = world({ trains: joinedInOld });
    await sync({ changes: { description: { from: "x" } } });
    expect(github.dispatches).toEqual([]);
  });
});

describe("a ! at the start of the description of an edit of the user of the token", () => {
  it("is taken out first, and the edit is done", async () => {
    const { github, oss, mirror, sync } = world({ trains: joinedBoth });
    oss.description = "!Notes of the release";
    await sync({ changes: { due_on: { from: "" } }, override: true });
    expect(github.updates[0]).toMatchObject({
      repository: OSS,
      description: "Notes of the release",
    });
    expect(oss.description).toBe(
      "Release Train: 2026.11.19\nNotes of the release",
    );
    expect(mirror.due_on).toBe("2026-11-19T12:00:00Z");
  });

  it("is taken out of a train line too", async () => {
    const { github, oss, sync } = world({ trains: joinedBoth });
    oss.description = "!Release Train: 2026.11.19\nNotes of the release";
    await sync({ changes: { due_on: { from: "" } }, override: true });
    expect(github.updates[0].description).toBe(
      "Release Train: 2026.11.19\nNotes of the release",
    );
  });

  it("is taken out of the milestone that was edited, in the commercial repository", async () => {
    const { github, fix, sync } = world({ trains: joinedBoth });
    fix.description = "!whatever";
    await sync({ repository: HOST, milestone: "7.0.9.1", override: true });
    expect(github.updates[0]).toMatchObject({
      repository: HOST,
      description: "whatever",
    });
    expect(fix.description).toBe("Release Train: 2026.11.19");
  });

  it("is all there is to it when nothing follows: the description is just !", async () => {
    const { github, oss, mirror, fix, sync } = world({ trains: joinedBoth });
    oss.description = "!";
    await sync({ changes: { due_on: { from: "" } }, override: true });
    expect(github.updates[0]).toMatchObject({
      repository: OSS,
      description: "",
    });
    expect(oss.description).toBe("Release Train: 2026.11.19");
    expect(mirror.due_on).toBe("2026-11-19T12:00:00Z");
    expect(fix.description).toBe("Release Train: 2026.11.19");
  });

  it("is left where it is without override", async () => {
    const { oss, sync } = world({ trains: joinedBoth });
    oss.description = "!Notes";
    await sync({ changes: { due_on: { from: "" } } });
    expect(oss.description).toBe("Release Train: 2026.11.19\n!Notes");
  });
});

describe("the commercial milestone of the release has the train line too", () => {
  it("has the line of the new train when it has joined, and keeps the link and the text", async () => {
    const { oss, mirror, sync } = world({
      ossDue: "2026-12-17",
      trains: {
        "2026.12.17": trainYaml({
          availability: "2027-01-21",
          joined: ["7.0.9", "7.0.9.1"],
        }),
      },
    });
    mirror.description = `Release Train: 2026.11.19\nmy notes\n\nOSS milestone: ${oss.html_url}`;
    await sync({ changes: { due_on: { from } } });
    expect(mirror.description).toBe(
      `Release Train: 2026.12.17\nmy notes\n\nOSS milestone: ${oss.html_url}`,
    );
  });

  it("loses the line, and keeps the link, when the due date is cleared", async () => {
    const { oss, mirror, sync } = world({ ossDue: "", trains: joinedInOld });
    mirror.description = `Release Train: 2026.11.19\nOSS milestone: ${oss.html_url}`;
    await sync({ changes: { due_on: { from } } });
    expect(mirror.description).toBe(`OSS milestone: ${oss.html_url}`);
  });

  it("is not written again when it is right", async () => {
    const { github, oss, mirror, sync } = world({ trains: joinedBoth });
    mirror.description = `Release Train: 2026.11.19\nOSS milestone: ${oss.html_url}`;
    mirror.due_on = "2026-11-19T12:00:00Z";
    await sync({ repository: HOST, milestone: "7.0.9" });
    expect(
      github.updates.filter(
        (u) => u.repository === HOST && u.number === mirror.number,
      ),
    ).toEqual([]);
  });
});

describe("the other edits", () => {
  it("ignores an edit of the OSS milestone that is not of its due date or description", async () => {
    const { github, sync } = world();
    const { actions } = await sync({ changes: { title: { from: "7.0.8" } } });
    expect(github.updates).toEqual([]);
    expect(github.dispatches).toEqual([]);
    expect(actions).toHaveLength(1);
  });

  it("puts back the train line of an OSS milestone whose description was edited", async () => {
    const { github, oss, sync } = world({ trains: joinedBoth });
    oss.description = "Release Train: 2026.01.01\nNotes of the release";
    await sync({
      changes: {
        description: {
          from: "Release Train: 2026.11.19\nNotes of the release",
        },
      },
    });
    expect(oss.description).toBe(
      "Release Train: 2026.11.19\nNotes of the release",
    );
    expect(github.dispatches).toEqual([]);
  });

  it("resyncs a hotfix that was edited, from its OSS milestone", async () => {
    const { github, fix, sync } = world({ trains: joinedBoth });
    fix.description = "Release Train: 2026.01.01";
    fix.due_on = due("2026-01-01");
    await sync({
      milestone: "7.0.9.1",
      repository: HOST,
      changes: { description: { from: "Release Train: 2026.11.19" } },
    });
    expect(fix.description).toBe("Release Train: 2026.11.19");
    expect(fix.due_on).toBe("2026-12-24T12:00:00Z");
    expect(github.dispatches).toEqual([]);
  });

  it("resyncs the commercial milestone of an OSS version that was edited", async () => {
    const { oss, mirror, sync } = world({ trains: joinedBoth });
    mirror.due_on = due("2026-03-01");
    mirror.description = "my notes";
    await sync({
      repository: HOST,
      milestone: "7.0.9",
      changes: { due_on: { from: "" } },
    });
    expect(mirror.due_on).toBe("2026-11-19T12:00:00Z");
    expect(mirror.description).toBe(
      `Release Train: 2026.11.19\nmy notes\n\nOSS milestone: ${oss.html_url}`,
    );
  });

  it("does nothing for a title that is not a release, or a hotfix whose OSS milestone does not exist", async () => {
    const { github, sync } = world();
    expect((await sync({ milestone: "7.0.x" })).actions).toHaveLength(1);
    expect(
      (await sync({ repository: HOST, milestone: "7.4.2.1" })).actions,
    ).toHaveLength(1);
    expect(
      (await sync({ repository: HOST, milestone: "7.4.2" })).actions,
    ).toHaveLength(1);
    expect(github.updates).toEqual([]);
  });
});

describe("a long-term support milestone", () => {
  const LTS = "embargoed/lts/5.8.x";
  function lts({ description, trains, due_on }) {
    const found = milestone(HOST, "5.8.30", { description, due_on });
    const github = fakeGitHub({
      milestones: { [OSS]: [], [HOST]: [found] },
      branches: ["release/5.8.30"],
      versions: { [LTS]: "5.8.30-SNAPSHOT" },
      trains,
    });
    const sync = (options) =>
      syncMilestone(
        {
          repository: HOST,
          milestone: "5.8.30",
          project: "spring-security",
          trainRepository: TRAINS,
          ...options,
        },
        { octokit: github, sleep: async () => {}, intervalMs: 0 },
      );
    return { github, found, sync };
  }

  it("is due on the commercial availability of the train that its description names, and the release workflow joins it", async () => {
    const { github, found, sync } = lts({
      description: "5.8.30\nRelease Train: 2026.11.19",
      trains: { "2026.11.19": trainYaml({ availability: "2026-12-24" }) },
    });
    await sync({ changes: { description: { from: "5.8.30" } } });
    expect(found.due_on).toBe("2026-12-24T12:00:00Z");
    // the line is what was typed, and is left as it is
    expect(found.description).toBe("5.8.30\nRelease Train: 2026.11.19");
    expect(dispatched(github)).toEqual([`rebuild ${LTS}`]);
  });

  it("does not start the release workflow for a release that joined", async () => {
    const { github, sync } = lts({
      description: "Release Train: 2026.11.19",
      trains: {
        "2026.11.19": trainYaml({
          availability: "2026-12-24",
          joined: ["5.8.30"],
        }),
      },
    });
    await sync({ changes: { description: { from: "5.8.30" } } });
    expect(github.dispatches).toEqual([]);
  });

  it("leaves the train that it was in when the line changes, and starts the release workflow", async () => {
    const { github, found, sync } = lts({
      description: "Release Train: 2026.12.17",
      trains: {
        "2026.11.19": trainYaml({ joined: ["5.8.30"] }),
        "2026.12.17": trainYaml({ availability: "2027-01-21" }),
      },
    });
    await sync({
      changes: { description: { from: "Release Train: 2026.11.19" } },
    });
    expect(dispatched(github)).toEqual([
      "leave release/5.8.30",
      `rebuild ${LTS}`,
    ]);
    expect(found.due_on).toBe("2027-01-21T12:00:00Z");
  });

  it("changes nothing, and joins nothing, if the train that the line names does not exist yet", async () => {
    const { github, found, sync } = lts({
      description: "Notes\nRelease Train: 2026.12.31",
      due_on: "2026-12-24T12:00:00Z",
      trains: { "2026.11.19": trainYaml({ joined: ["5.8.30"] }) },
    });
    await sync({
      changes: { description: { from: "Notes\nRelease Train: 2026.11.19" } },
    });
    // it leaves the train that it was in, and keeps the line and the due date
    expect(dispatched(github)).toEqual(["leave release/5.8.30"]);
    expect(found.description).toBe("Notes\nRelease Train: 2026.12.31");
    expect(found.due_on).toBe("2026-12-24T12:00:00Z");
  });

  it("leaves the train and clears the date if the line is taken out", async () => {
    const { github, found, sync } = lts({
      description: "Notes",
      due_on: "2026-12-24T12:00:00Z",
      trains: { "2026.11.19": trainYaml({ joined: ["5.8.30"] }) },
    });
    await sync({
      changes: { description: { from: "Notes\nRelease Train: 2026.11.19" } },
    });
    expect(dispatched(github)).toEqual(["leave release/5.8.30"]);
    expect(found.due_on).toBeNull();
  });

  it("says that a train that is ready cannot be left, and changes nothing else", async () => {
    const { github, found, sync } = lts({
      description: "Release Train: 2026.12.17",
      trains: {
        "2026.11.19": trainYaml({ joined: ["5.8.30"], ready: ["5.8.30"] }),
        "2026.12.17": trainYaml({}),
      },
    });
    await sync({
      changes: { description: { from: "Release Train: 2026.11.19" } },
    });
    expect(github.dispatches).toEqual([]);
    expect(found.description).toBe(
      "ERROR: Cannot leave the Release Train 2026.11.19: it is ready",
    );
  });

  it("is not a milestone of the handler if there is no long-term support branch for it", async () => {
    const github = fakeGitHub({
      milestones: { [OSS]: [], [HOST]: [milestone(HOST, "6.4.21")] },
      branches: [],
      trains: {},
    });
    const { actions } = await syncMilestone(
      {
        repository: HOST,
        milestone: "6.4.21",
        project: "spring-security",
        trainRepository: TRAINS,
      },
      { octokit: github },
    );
    expect(actions).toHaveLength(1);
    expect(github.updates).toEqual([]);
  });
});
