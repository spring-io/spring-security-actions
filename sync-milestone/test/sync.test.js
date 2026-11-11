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

/** The OSS milestone 7.0.9 (due 2026-11-19), its mirror, and the hotfix. */
function world({
  ossDue = "2026-11-19",
  trains,
  branches,
  hotfix = true,
  user,
} = {}) {
  const oss = milestone(OSS, "7.0.9", {
    due_on: ossDue ? due(ossDue) : null,
    description: "Release Train: 2026.11.19\nNotes of the release",
  });
  const mirror = milestone(HOST, "7.0.9", { state: "closed" });
  const fix = milestone(HOST, "7.0.9.1");
  const github = fakeGitHub({
    milestones: {
      [OSS]: [oss],
      [HOST]: hotfix ? [mirror, fix] : [mirror],
    },
    branches: branches ?? [
      "release/7.0.9",
      "release/7.0.9.1",
      "embargoed/lts/5.8.x",
      "release/5.8.30",
    ],
    trains: trains ?? {
      "2026.11.19": trainYaml({ availability: "2026-12-24" }),
      "2026.12.17": trainYaml({ availability: "2027-01-21" }),
    },
    user,
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
      { octokit: github },
    );
  return { github, oss, mirror, fix, sync };
}

const dispatched = (github) =>
  github.dispatches.map(
    (d) =>
      `${d.workflow.replace("release-train-", "").replace(".yml", "")} ${d.ref}`,
  );

describe("an OSS milestone gets a due date", () => {
  it("joins the release and its hotfix to the train of the date, and the milestones follow", async () => {
    const { github, oss, mirror, fix, sync } = world();
    oss.description = "Notes of the release";
    await sync({ changes: { due_on: { from: "" } } });
    expect(github.dispatches).toEqual([
      {
        repository: HOST,
        workflow: "release-train-join.yml",
        ref: "release/7.0.9",
        inputs: {
          "deployment-destination": "Maven Central",
          "release-train": "2026.11.19",
          "release-train-repository": TRAINS,
        },
      },
      {
        repository: HOST,
        workflow: "release-train-join.yml",
        ref: "release/7.0.9.1",
        inputs: {
          "deployment-destination": "Spring Enterprise",
          "release-train": "2026.11.19",
          "release-train-repository": TRAINS,
        },
      },
    ]);
    expect(oss.description).toBe(
      "Release Train: 2026.11.19\nNotes of the release",
    );
    expect(mirror.due_on).toBe("2026-11-19T12:00:00Z");
    expect(mirror.description).toBe(
      `Release Train: 2026.11.19\nOSS milestone: ${oss.html_url}`,
    );
    expect(fix.due_on).toBe("2026-12-24T12:00:00Z");
    expect(fix.description).toBe("Release Train: 2026.11.19");
  });

  it("does nothing the second time: no edit, and no dispatch", async () => {
    const { github, sync } = world();
    await sync({ changes: { due_on: { from: "" } } });
    const edits = github.updates.length;
    const runs = github.dispatches.length;
    // the train says that both joined by now
    github.rest.repos.getContent = async () => ({
      data: {
        type: "file",
        content: Buffer.from(
          trainYaml({ joined: ["7.0.9", "7.0.9.1"] }),
        ).toString("base64"),
      },
    });
    const { actions } = await sync({ changes: { due_on: { from: "" } } });
    expect(github.updates).toHaveLength(edits);
    expect(github.dispatches).toHaveLength(runs);
    expect(actions).toEqual([]);
  });

  it("does not join a release that joined already", async () => {
    const { github, sync } = world({
      trains: {
        "2026.11.19": trainYaml({ joined: ["7.0.9", "7.0.9.1"] }),
      },
    });
    await sync({ changes: { due_on: { from: "" } } });
    expect(github.dispatches).toEqual([]);
  });

  it("leaves a hotfix alone if its milestone does not exist", async () => {
    const { github, sync } = world({ hotfix: false });
    await sync({ changes: { due_on: { from: "" } } });
    expect(dispatched(github)).toEqual(["join release/7.0.9"]);
  });

  it("says in the description that a release branch does not exist, and joins the others", async () => {
    const { github, oss, fix, sync } = world({ branches: ["release/7.0.9.1"] });
    await sync({ changes: { due_on: { from: "" } } });
    expect(dispatched(github)).toEqual(["join release/7.0.9.1"]);
    expect(oss.description).toBe(
      "ERROR: Cannot join the Release Train 2026.11.19: release/7.0.9 does not exist\nNotes of the release",
    );
    expect(fix.description).toBe("Release Train: 2026.11.19");
  });

  it("says in the description of the hotfix that its branch does not exist", async () => {
    const { oss, fix, sync } = world({ branches: ["release/7.0.9"] });
    await sync({ changes: { due_on: { from: "" } } });
    expect(oss.description).toBe(
      "Release Train: 2026.11.19\nNotes of the release",
    );
    expect(fix.description).toBe(
      "ERROR: Cannot join the Release Train 2026.11.19: release/7.0.9.1 does not exist",
    );
    // the due date is set all the same
    expect(fix.due_on).toBe("2026-12-24T12:00:00Z");
  });

  it("writes the lines without running the workflows with dispatch false", async () => {
    const { github, oss, fix, sync } = world();
    await sync({ dispatch: false });
    expect(github.dispatches).toEqual([]);
    expect(oss.description).toBe(
      "Release Train: 2026.11.19\nNotes of the release",
    );
    expect(fix.description).toBe("Release Train: 2026.11.19");
  });
});

describe("the due date of an OSS milestone changes", () => {
  const joinedInOld = {
    "2026.11.19": trainYaml({ joined: ["7.0.9", "7.0.9.1"] }),
    "2026.12.17": trainYaml({ availability: "2027-01-21" }),
  };

  it("leaves the train that it was in, and joins the new one", async () => {
    const { github, oss, mirror, fix, sync } = world({
      ossDue: "2026-12-17",
      trains: joinedInOld,
    });
    await sync({ changes: { due_on: { from: due("2026-11-19") } } });
    expect(dispatched(github)).toEqual([
      "leave release/7.0.9",
      "leave release/7.0.9.1",
      "join release/7.0.9",
      "join release/7.0.9.1",
    ]);
    expect(github.dispatches[0].inputs).toEqual({
      "release-train": "2026.11.19",
      "release-train-repository": TRAINS,
    });
    expect(oss.description).toBe(
      "Release Train: 2026.12.17\nNotes of the release",
    );
    expect(mirror.due_on).toBe("2026-12-17T12:00:00Z");
    expect(fix.due_on).toBe("2027-01-21T12:00:00Z");
    expect(fix.description).toBe("Release Train: 2026.12.17");
  });

  it("reads the previous due date as an instant, as GitHub sends it in the time zone of the editor", async () => {
    const { github, sync } = world({
      ossDue: "2026-12-17",
      trains: joinedInOld,
    });
    await sync({ changes: { due_on: { from } } });
    expect(dispatched(github).slice(0, 2)).toEqual([
      "leave release/7.0.9",
      "leave release/7.0.9.1",
    ]);
    expect(github.dispatches[0].inputs["release-train"]).toBe("2026.11.19");
  });

  it("reads an offset that is ahead of UTC and one with daylight saving", async () => {
    for (const previous of [
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

  it("clears the date and says that the train does not exist, and leaves the old one", async () => {
    const { github, oss, mirror, fix, sync } = world({
      ossDue: "2026-12-31",
      trains: joinedInOld,
    });
    await sync({ changes: { due_on: { from: due("2026-11-19") } } });
    expect(dispatched(github)).toEqual([
      "leave release/7.0.9",
      "leave release/7.0.9.1",
    ]);
    expect(oss.due_on).toBeNull();
    expect(oss.description).toBe(
      "ERROR: The Release Train 2026.12.31 doesn't exist\nNotes of the release",
    );
    expect(mirror.due_on).toBeNull();
    expect(fix.due_on).toBeNull();
    expect(fix.description).toBe(
      "ERROR: The Release Train 2026.12.31 doesn't exist",
    );
  });

  it("leaves the train, and takes the line out, if the due date is cleared", async () => {
    const { github, oss, mirror, fix, sync } = world({
      ossDue: "",
      trains: joinedInOld,
    });
    mirror.due_on = due("2026-11-19");
    fix.due_on = due("2026-12-24");
    fix.description = "Release Train: 2026.11.19";
    await sync({ changes: { due_on: { from: due("2026-11-19") } } });
    expect(dispatched(github)).toEqual([
      "leave release/7.0.9",
      "leave release/7.0.9.1",
    ]);
    expect(oss.description).toBe("Notes of the release");
    expect(mirror.due_on).toBeNull();
    expect(fix.due_on).toBeNull();
    expect(fix.description).toBe("");
  });

  it("finds the train to leave in the description when the previous date is not known", async () => {
    const { github, sync } = world({
      ossDue: "2026-12-17",
      trains: joinedInOld,
    });
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
    await sync({ changes: { due_on: { from: due("2026-11-19") } } });
    expect(dispatched(github).filter((d) => d.startsWith("leave"))).toEqual([]);
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
    await sync({ changes: { due_on: { from: due("2026-11-19") } } });
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
});

describe("a ! at the start of the description of an edit of the user of the token", () => {
  it("is taken out first, and the edit is done", async () => {
    const { github, oss, mirror, sync } = world();
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
    expect(dispatched(github)).toEqual([
      "join release/7.0.9",
      "join release/7.0.9.1",
    ]);
  });

  it("is taken out of a train line too", async () => {
    const { github, oss, sync } = world();
    oss.description = "!Release Train: 2026.11.19\nNotes of the release";
    await sync({ changes: { due_on: { from: "" } }, override: true });
    expect(github.updates[0].description).toBe(
      "Release Train: 2026.11.19\nNotes of the release",
    );
  });

  it("is taken out of the milestone that was edited, in the commercial repository", async () => {
    const { github, fix, sync } = world();
    fix.description = "!whatever";
    await sync({ repository: HOST, milestone: "7.0.9.1", override: true });
    expect(github.updates[0]).toMatchObject({
      repository: HOST,
      description: "whatever",
    });
    expect(fix.description).toBe("Release Train: 2026.11.19");
  });

  it("is all there is to it when nothing follows: the description is just !", async () => {
    const { github, oss, mirror, fix, sync } = world();
    oss.description = "!";
    await sync({ changes: { due_on: { from: "" } }, override: true });
    expect(github.updates[0]).toMatchObject({
      repository: OSS,
      description: "",
    });
    expect(oss.description).toBe("Release Train: 2026.11.19");
    expect(mirror.due_on).toBe("2026-11-19T12:00:00Z");
    expect(fix.description).toBe("Release Train: 2026.11.19");
    expect(dispatched(github)).toEqual([
      "join release/7.0.9",
      "join release/7.0.9.1",
    ]);
  });

  it("clears the due date of a milestone whose description is just !", async () => {
    const { github, oss, sync } = world({
      ossDue: "2026-12-31",
      trains: { "2026.11.19": trainYaml({ joined: ["7.0.9", "7.0.9.1"] }) },
    });
    oss.description = "!";
    await sync({
      changes: { due_on: { from: due("2026-11-19") } },
      override: true,
    });
    expect(oss.due_on).toBeNull();
    expect(oss.description).toBe(
      "ERROR: The Release Train 2026.12.31 doesn't exist",
    );
    expect(dispatched(github)).toEqual([
      "leave release/7.0.9",
      "leave release/7.0.9.1",
    ]);
  });

  it("is left where it is without override", async () => {
    const { oss, sync } = world();
    oss.description = "!Notes";
    await sync({ changes: { due_on: { from: "" } } });
    expect(oss.description).toBe("Release Train: 2026.11.19\n!Notes");
  });
});

describe("the commercial milestone of the release has the train line too", () => {
  const joinedInOld = {
    "2026.11.19": trainYaml({ joined: ["7.0.9", "7.0.9.1"] }),
    "2026.12.17": trainYaml({ availability: "2027-01-21" }),
  };

  it("has the line of the new train when the due date changes, and keeps the link and the text", async () => {
    const { oss, mirror, sync } = world({
      ossDue: "2026-12-17",
      trains: joinedInOld,
    });
    mirror.description = `Release Train: 2026.11.19\nmy notes\n\nOSS milestone: ${oss.html_url}`;
    await sync({ changes: { due_on: { from } } });
    expect(mirror.description).toBe(
      `Release Train: 2026.12.17\nmy notes\n\nOSS milestone: ${oss.html_url}`,
    );
  });

  it("has the same error as the OSS milestone if the train does not exist", async () => {
    const { oss, mirror, sync } = world({
      ossDue: "2026-12-31",
      trains: joinedInOld,
    });
    await sync({ changes: { due_on: { from } } });
    expect(mirror.description).toBe(
      `ERROR: The Release Train 2026.12.31 doesn't exist\nOSS milestone: ${oss.html_url}`,
    );
    expect(mirror.due_on).toBeNull();
  });

  it("has the error that the release cannot join, like the OSS milestone", async () => {
    const { mirror, oss, sync } = world({ branches: [] });
    await sync({ changes: { due_on: { from: "" } } });
    const first =
      "ERROR: Cannot join the Release Train 2026.11.19: release/7.0.9 does not exist";
    expect(oss.description.split("\n")[0]).toBe(first);
    expect(mirror.description.split("\n")[0]).toBe(first);
  });

  it("loses the line, and keeps the link, when the due date is cleared", async () => {
    const { oss, mirror, sync } = world({ ossDue: "", trains: joinedInOld });
    mirror.description = `Release Train: 2026.11.19\nOSS milestone: ${oss.html_url}`;
    await sync({ changes: { due_on: { from } } });
    expect(mirror.description).toBe(`OSS milestone: ${oss.html_url}`);
  });

  it("is not written again when it is right", async () => {
    const { github, oss, mirror, sync } = world({
      trains: { "2026.11.19": trainYaml({ joined: ["7.0.9", "7.0.9.1"] }) },
    });
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
    const { github, oss, sync } = world({
      trains: { "2026.11.19": trainYaml({ joined: ["7.0.9", "7.0.9.1"] }) },
    });
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
    const { github, fix, sync } = world({
      trains: { "2026.11.19": trainYaml({ joined: ["7.0.9", "7.0.9.1"] }) },
    });
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
    const { oss, mirror, sync } = world({
      trains: { "2026.11.19": trainYaml({ joined: ["7.0.9", "7.0.9.1"] }) },
    });
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
  function lts({ description, trains }) {
    const found = milestone(HOST, "5.8.30", { description });
    const github = fakeGitHub({
      milestones: { [OSS]: [], [HOST]: [found] },
      branches: ["embargoed/lts/5.8.x", "release/5.8.30"],
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
        { octokit: github },
      );
    return { github, found, sync };
  }

  it("joins the train that its description names, and is due on its commercial availability", async () => {
    const { github, found, sync } = lts({
      description: "5.8.30\nRelease Train: 2026.11.19",
      trains: { "2026.11.19": trainYaml({ availability: "2026-12-24" }) },
    });
    await sync({ changes: { description: { from: "5.8.30" } } });
    expect(github.dispatches).toEqual([
      {
        repository: HOST,
        workflow: "release-train-join.yml",
        ref: "release/5.8.30",
        inputs: {
          "deployment-destination": "Spring Enterprise",
          "release-train": "2026.11.19",
          "release-train-repository": TRAINS,
        },
      },
    ]);
    expect(found.due_on).toBe("2026-12-24T12:00:00Z");
    expect(found.description).toBe("5.8.30\nRelease Train: 2026.11.19");
  });

  it("leaves the train that it was in when the line changes, and joins the new one", async () => {
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
      "join release/5.8.30",
    ]);
    expect(found.due_on).toBe("2027-01-21T12:00:00Z");
  });

  it("replaces the line with an error, clears the date and leaves, if the train does not exist", async () => {
    const { github, found, sync } = lts({
      description: "Notes\nRelease Train: 2026.12.31",
      trains: { "2026.11.19": trainYaml({ joined: ["5.8.30"] }) },
    });
    found.due_on = "2026-12-24T12:00:00Z";
    await sync({
      changes: { description: { from: "Notes\nRelease Train: 2026.11.19" } },
    });
    expect(dispatched(github)).toEqual(["leave release/5.8.30"]);
    expect(found.description).toBe(
      "Notes\nERROR: The Release Train 2026.12.31 doesn't exist",
    );
    expect(found.due_on).toBeNull();
  });

  it("leaves the train and clears the date if the line is taken out", async () => {
    const { github, found, sync } = lts({
      description: "Notes",
      trains: { "2026.11.19": trainYaml({ joined: ["5.8.30"] }) },
    });
    found.due_on = "2026-12-24T12:00:00Z";
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
