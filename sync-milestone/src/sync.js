import {
  cannotLeave,
  noAvailability,
  trainLine,
  trainOf,
  trainOfDate,
  withFirstLine,
  withLink,
  withTrainLine,
} from "./descriptions.js";
import { call, parseRepository } from "./octokit.js";
import { rebuildReleases } from "./rebuild.js";
import {
  commercialAvailability,
  dateOf,
  hashesOf,
  noon,
  readTrain,
} from "./trains.js";

export const LEAVE_WORKFLOW = "release-train-leave.yml";

const RELEASE = /^\d+\.\d+\.\d+(-(M|RC)\d+)?$/;
const PATCH = /^\d+\.\d+\.\d+$/;
const HOTFIX = /^\d+\.\d+\.\d+\.\d+$/;

/** The OSS repository and the commercial one, from either: the commercial one ends with -commercial. */
export function repositoriesOf(repository) {
  return repository.endsWith("-commercial")
    ? { oss: repository.slice(0, -"-commercial".length), host: repository }
    : { oss: repository, host: `${repository}-commercial` };
}

/**
 * Keeps the milestones of a release in step with its release train, and says what it did.
 *
 * A release of OSS (7.0.9) is made in the OSS repository, in the release train of its due
 * date (the train 2026.11.19 for a milestone due on 2026-11-19). Its hotfix (7.0.9.1) is in
 * the commercial repository, in the same train, and is due on the commercial general
 * availability of it. The commercial milestone of the release itself follows the due date.
 * The first line of the description of the OSS milestone and of its commercial milestone, and
 * the description of the hotfix, name the train: `Release Train: 2026.11.19`. An edit of any of them, in either
 * repository, makes them all follow the OSS milestone.
 *
 * A long-term support version (5.8.30) is only in the commercial repository, and its
 * description names its train (typed by a person): the due date follows the train.
 *
 * - A due date is kept when its train does not exist (yet): the milestones just have no
 *   train line, and the line comes once the release is in the train. A train that has no
 *   commercial general availability makes the hotfix say ERROR: and why.
 * - A release is never joined here. The release workflow joins it, once it has built the
 *   release branch, so that the branch has the dependency updates of the train. A release
 *   that is not built is not joined, which is not an error. When the due date (or the line of
 *   a long-term support milestone) changes, the release leaves the train that it was in, and
 *   its branches are built again, which joins the new one (see rebuildReleases).
 * - The line is written when the train says that the release has joined, or with `dispatch`
 *   false, which is for the release workflow, right after it joined.
 * - A release that joined a train that it is not due in any more leaves it (the previous
 *   train is known from the previous due date, or from the line that the description had).
 *   If that train is ready it cannot, and the description says so, and nothing is changed.
 *
 * Nothing is written to a milestone that is right already, so that a run that is done again
 * makes no edit (and so no event of GitHub).
 *
 * `dryRun` does the same and writes nothing and runs nothing: `actions` says what would be
 * done, and `events` has it in a form that can be counted (see syncAll). What it would write
 * is kept in memory, so that what comes after sees it, as it would.
 *
 * `override` is for an edit that the user of the token made on purpose: its description
 * starts with !, which is taken out first (that edit is the handler's own, and is ignored,
 * so it does not run it again).
 *
 * `changes` is the field `changes` of the event of GitHub, with what the edit changed
 * (due_on, description or title, each with `from`). `dispatch` false runs nothing (no leave,
 * no rebuild) and takes the releases as joined: it is for after the release workflow joined,
 * to write the lines. `rebuild` false does not start the rebuild (the nightly run does it).
 */
export async function syncMilestone(
  {
    repository,
    milestone: title,
    changes,
    project,
    trainRepository,
    dispatch = true,
    rebuild = true,
    override = false,
    dryRun = false,
  },
  { octokit, log = () => {}, ...timing },
) {
  const { oss, host } = repositoriesOf(repository);
  const actions = [];
  const events = [];
  const lists = new Map();
  const trains = new Map();
  const note = (line) => {
    actions.push(line);
    log(line);
  };

  const list = async (repo) => {
    if (!lists.has(repo)) {
      const { owner, repo: name } = parseRepository(repo);
      lists.set(
        repo,
        await call(
          `Reading the milestones of ${repo}`,
          octokit.paginate(octokit.rest.issues.listMilestones, {
            owner,
            repo: name,
            state: "all",
            per_page: 100,
          }),
        ),
      );
    }
    return lists.get(repo);
  };
  const find = async (repo, wanted) =>
    wanted ? (await list(repo)).find((m) => m.title === wanted) : undefined;
  const trainNamed = async (name) => {
    if (!trains.has(name)) {
      trains.set(name, await readTrain(octokit, trainRepository, name));
    }
    return trains.get(name);
  };

  // Writes what is different: { date: "2026-11-19" | null, description }
  const write = async (repo, found, { date, description }) => {
    const update = {};
    if (date !== undefined) {
      const current = dateOf(found.due_on);
      if ((date ?? "") !== current) {
        update.due_on = date === null ? null : noon(date);
      }
    }
    if (
      description !== undefined &&
      description !== (found.description ?? "")
    ) {
      update.description = description;
    }
    if (Object.keys(update).length === 0) {
      return;
    }
    const { owner, repo: name } = parseRepository(repo);
    if (!dryRun) {
      await call(
        `Updating the milestone ${found.title} of ${repo}`,
        octokit.rest.issues.updateMilestone({
          owner,
          repo: name,
          milestone_number: found.number,
          ...update,
        }),
      );
    }
    events.push({
      type: "update",
      repository: repo,
      title: found.title,
      due: "due_on" in update,
      description: "description" in update,
    });
    Object.assign(found, {
      ...(update.due_on !== undefined && { due_on: update.due_on }),
      ...(update.description !== undefined && {
        description: update.description,
      }),
    });
    note(
      `${dryRun ? "would change" : "changed"} ${repo} ${found.title}: ${[
        "due_on" in update
          ? update.due_on === null
            ? "due date cleared"
            : `due ${date}`
          : "",
        "description" in update
          ? `description is now: ${update.description.split("\n")[0] || "(empty)"}`
          : "",
      ]
        .filter(Boolean)
        .join(", ")}`,
    );
  };

  const releaseExists = async (version) => {
    const { owner, repo } = parseRepository(host);
    try {
      await octokit.rest.repos.getBranch({
        owner,
        repo,
        branch: `release/${version}`,
      });
      return true;
    } catch (error) {
      if (error.status === 404) {
        return false;
      }
      throw error;
    }
  };

  const run = async (workflow, version, inputs) => {
    if (dryRun) {
      return;
    }
    const { owner, repo } = parseRepository(host);
    await call(
      `Running ${workflow} on release/${version} of ${host}`,
      octokit.rest.actions.createWorkflowDispatch({
        owner,
        repo,
        workflow_id: workflow,
        ref: `release/${version}`,
        inputs,
      }),
    );
  };

  // whether the train says that the release is in it (or, with dispatch false, as it was just joined)
  const joinedIn = (version, train) =>
    !dispatch || Boolean(hashesOf(train, project, version).joined);

  // starts the release workflow on the branches of the releases, which builds them against the
  // train and joins it
  const rebuildAfterChange = async (versions) => {
    if (!dispatch || !rebuild) {
      return;
    }
    const { results } = await rebuildReleases(
      {
        repositories: { oss, host },
        project,
        trainRepository,
        only: versions,
        dryRun,
      },
      { octokit, log, ...timing },
    );
    for (const r of results) {
      events.push({ type: "rebuild", branch: r.branch, result: r.result });
      note(
        `${r.branch} (${r.release}): ${dryRun ? "would be rebuilt" : r.result}${r.reason ? `, ${r.reason}` : ""}`,
      );
    }
    const failed = results.filter((r) => r.result === "failed");
    if (failed.length > 0) {
      throw new Error(
        `The release workflow failed: ${failed.map((r) => `${r.branch}: ${r.reason}`).join("; ")}`,
      );
    }
  };

  /**
   * Leaves the trains that the versions are in and should not be in: the ones that are
   * ready cannot be left, and { blocked } says which. It runs nothing if one is blocked.
   */
  const leave = async (names, versions) => {
    const leaves = [];
    for (const name of names) {
      const train = await trainNamed(name);
      if (!train.found) {
        continue;
      }
      for (const version of versions) {
        const hashes = hashesOf(train, project, version);
        if (hashes.joined && hashes.ready) {
          return { blocked: name };
        }
        if (hashes.joined) {
          leaves.push({ name, version });
        }
      }
    }
    if (dispatch) {
      for (const { name, version } of leaves) {
        if (!(await releaseExists(version))) {
          note(`release/${version} does not exist, so it cannot leave ${name}`);
          continue;
        }
        await run(LEAVE_WORKFLOW, version, {
          "release-train": name,
          "release-train-repository": trainRepository,
        });
        events.push({ type: "leave", version, train: name });
        note(
          `${version} ${dryRun ? "would leave" : "leaves"} the release train ${name}`,
        );
      }
    }
    return {};
  };

  // the release of OSS, and what follows it
  const syncRelease = async (ossTitle, { fromOss }) => {
    const found = await find(oss, ossTitle);
    if (!found) {
      note(`${oss} has no milestone ${ossTitle}: nothing to do`);
      return;
    }
    if (fromOss && changes && !changes.due_on && !changes.description) {
      note(
        `${oss} ${ossTitle}: neither the due date nor the description changed`,
      );
      return;
    }
    const hotTitle = PATCH.test(ossTitle) ? `${ossTitle}.1` : "";
    const hotfix = await find(host, hotTitle);
    const mirror = await find(host, ossTitle);
    const date = dateOf(found.due_on);
    const name = trainOfDate(date);

    // the trains that the versions may be in, and are not due in any more
    const previous = new Set([
      changes?.due_on ? trainOfDate(dateOf(changes.due_on.from)) : "",
      trainOf(changes?.description?.from),
      trainOf(found.description),
      trainOf(hotfix?.description),
    ]);
    previous.delete("");
    previous.delete(name);
    const versions = [ossTitle, ...(hotfix ? [hotTitle] : [])];
    const left = await leave([...previous], versions);
    if (left.blocked) {
      const line = cannotLeave(left.blocked);
      note(`${left.blocked} is ready: it cannot be left`);
      await write(oss, found, {
        description: withFirstLine(found.description, line),
      });
      if (hotfix) {
        await write(host, hotfix, { description: line });
      }
      return;
    }

    // The date is kept. The line is there once the train says that the release is in it, and
    // a train that does not exist (yet) has none. The hotfix is due on the commercial general
    // availability of the train, which is not known without one: its due date stays.
    let ossLine = "";
    let hotLine = "";
    let hotDate;
    let train;
    if (name) {
      train = await trainNamed(name);
      if (train.found) {
        ossLine = joinedIn(ossTitle, train) ? trainLine(name) : "";
        if (hotfix) {
          const availability = commercialAvailability(train);
          if (!availability) {
            hotLine = noAvailability(name);
          } else {
            hotDate = availability;
            hotLine = joinedIn(hotTitle, train) ? trainLine(name) : "";
          }
        }
      } else {
        note(
          `The release train ${name} does not exist yet: the due date is kept, and the milestones have no train line`,
        );
      }
    } else {
      hotDate = null;
    }

    await write(oss, found, {
      description: withFirstLine(found.description, ossLine),
    });
    if (mirror) {
      // the same first line as the OSS milestone, and the link to it after the text
      await write(host, mirror, {
        date: date || null,
        description: withFirstLine(
          withLink(mirror.description, found.html_url),
          ossLine,
        ),
      });
    }
    if (hotfix) {
      await write(host, hotfix, {
        ...(hotDate !== undefined && { date: hotDate }),
        description: hotLine,
      });
    }
    // the due date moved, and the train that it is in now has not got the release: build it
    // again, which joins it
    if (
      changes?.due_on &&
      train?.found &&
      !hashesOf(train, project, ossTitle).joined
    ) {
      await rebuildAfterChange(versions);
    }
  };

  // a long-term support version, which names its train in its description
  const syncLts = async (ltsTitle) => {
    const found = await find(host, ltsTitle);
    if (!found) {
      return;
    }
    if (changes && !changes.description && !changes.due_on) {
      note(
        `${host} ${ltsTitle}: neither the due date nor the description changed`,
      );
      return;
    }
    const name = trainOf(found.description);
    const previous = trainOf(changes?.description?.from);
    const left = await leave(previous && previous !== name ? [previous] : [], [
      ltsTitle,
    ]);
    if (left.blocked) {
      note(`${left.blocked} is ready: it cannot be left`);
      await write(host, found, {
        description: withTrainLine(
          found.description,
          cannotLeave(left.blocked),
        ),
      });
      return;
    }
    if (!name) {
      await write(host, found, { date: null });
      return;
    }
    // the line is what a person typed, and is left as it is. A train that does not exist (yet)
    // keeps the due date as it is, and nothing is joined.
    const train = await trainNamed(name);
    if (!train.found) {
      note(
        `The release train ${name} does not exist yet: nothing is changed, and the release is not joined`,
      );
      return;
    }
    const availability = commercialAvailability(train);
    if (!availability) {
      await write(host, found, {
        description: withTrainLine(found.description, noAvailability(name)),
      });
      return;
    }
    await write(host, found, { date: availability });
    if (changes?.description && !hashesOf(train, project, ltsTitle).joined) {
      await rebuildAfterChange([ltsTitle]);
    }
  };

  if (!RELEASE.test(title) && !HOTFIX.test(title)) {
    note(`${title} is not the version of a release: nothing to do`);
    return { actions, events };
  }
  if (override) {
    const edited = await find(repository, title);
    if (edited?.description?.startsWith("!")) {
      await write(repository, edited, {
        description: edited.description.slice(1),
      });
      note(
        `${repository} ${title}: the ! at the start of the description is taken out`,
      );
    }
  }
  if (repository === oss) {
    await syncRelease(title, { fromOss: true });
  } else if (HOTFIX.test(title)) {
    const parent = title.split(".").slice(0, 3).join(".");
    if (await find(oss, parent)) {
      await syncRelease(parent, { fromOss: false });
    } else {
      note(
        `${oss} has no milestone ${parent}, which ${title} is the hotfix of: nothing to do`,
      );
    }
  } else if (await find(oss, title)) {
    await syncRelease(title, { fromOss: false });
  } else if (
    (await isLts(octokit, host, title)) ||
    trainOf((await find(host, title))?.description) ||
    trainOf(changes?.description?.from)
  ) {
    // long-term support: it has a branch for it, or its description names a train
    await syncLts(title);
  } else {
    note(
      `${title} is not a milestone of OSS, and ${host} has no long-term support branch for it: nothing to do`,
    );
  }
  return { actions, events };
}

/** Whether the commercial repository has the long-term support branch of a version (5.8.30 is embargoed/lts/5.8.x). */
export async function isLts(octokit, host, version) {
  const [major, minor] = version.split(".");
  const { owner, repo } = parseRepository(host);
  try {
    await octokit.rest.repos.getBranch({
      owner,
      repo,
      branch: `embargoed/lts/${major}.${minor}.x`,
    });
    return true;
  } catch (error) {
    if (error.status === 404) {
      return false;
    }
    throw error;
  }
}

const byVersion = (a, b) =>
  a.title.localeCompare(b.title, undefined, { numeric: true });

/**
 * Syncs every open milestone of a project that has a release: the OSS milestones of the
 * releases (each with its commercial milestone and its hotfix), and the commercial milestones
 * of long-term support that have no OSS milestone. What was done for each, and the totals,
 * are returned: see syncMilestone, which it calls for each, with no previous train known (the
 * descriptions have it). The trackers of the next release, anything that is not the version
 * of a release, and an OSS milestone with no due date and no train line (it has never been in
 * a train, and its commercial milestone may be one that was released long ago), are left
 * alone.
 */
export async function syncAll(
  { repository, project, trainRepository, dispatch = true, dryRun = false },
  { octokit, log = () => {} },
) {
  const { oss, host } = repositoriesOf(repository);
  const list = async (repo, state) => {
    const { owner, repo: name } = parseRepository(repo);
    return call(
      `Reading the milestones of ${repo}`,
      octokit.paginate(octokit.rest.issues.listMilestones, {
        owner,
        repo: name,
        state,
        per_page: 100,
      }),
    );
  };
  const ossAll = await list(oss, "all");
  const known = new Set(ossAll.map((m) => m.title));
  const targets = [
    // a milestone with no due date and no line has never been in a train: there is nothing to sync
    ...ossAll
      .filter(
        (m) =>
          m.state === "open" &&
          RELEASE.test(m.title) &&
          (m.due_on || trainOf(m.description)),
      )
      .sort(byVersion)
      .map((m) => ({ repository: oss, title: m.title })),
    // long-term support: it has no OSS milestone, and a branch for it or a line in its description
    ...(
      await Promise.all(
        (await list(host, "open"))
          .filter((m) => PATCH.test(m.title) && !known.has(m.title))
          .sort(byVersion)
          .map(async (m) =>
            trainOf(m.description) || (await isLts(octokit, host, m.title))
              ? { repository: host, title: m.title }
              : undefined,
          ),
      )
    ).filter(Boolean),
  ];
  const results = [];
  for (const target of targets) {
    const { actions, events } = await syncMilestone(
      {
        repository: target.repository,
        milestone: target.title,
        project,
        trainRepository,
        dispatch,
        rebuild: false,
        dryRun,
      },
      { octokit, log },
    );
    results.push({ ...target, actions, events });
  }
  const events = results.flatMap((r) => r.events);
  const count = (predicate) => events.filter(predicate).length;
  return {
    results,
    totals: {
      milestones: results.length,
      descriptions: count((e) => e.type === "update" && e.description),
      dueDates: count((e) => e.type === "update" && e.due),
      leaves: count((e) => e.type === "leave"),
      rebuilds: count((e) => e.type === "rebuild"),
    },
  };
}
