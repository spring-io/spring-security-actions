import {
  cannotJoin,
  cannotLeave,
  missingTrain,
  noAvailability,
  trainLine,
  trainOf,
  trainOfDate,
  withFirstLine,
  withLink,
  withTrainLine,
} from "./descriptions.js";
import { call, parseRepository } from "./octokit.js";
import {
  commercialAvailability,
  dateOf,
  hashesOf,
  noon,
  readTrain,
} from "./trains.js";

export const JOIN_WORKFLOW = "release-train-join.yml";
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
 * - A train that does not exist, or has no commercial general availability: the due date
 *   is cleared, and the description says ERROR: and why.
 * - A release branch (release/7.0.9) that does not exist cannot join: the description says
 *   so.
 * - A release that joined a train that it is not due in any more leaves it (the previous
 *   train is known from the previous due date, or from the line that the description had).
 *   If that train is ready it cannot, and the description says so, and nothing is changed.
 *
 * Nothing is written to a milestone that is right already, so that a run that is done again
 * makes no edit (and so no event of GitHub).
 *
 * `override` is for an edit that the user of the token made on purpose: its description
 * starts with !, which is taken out first (that edit is the handler's own, and is ignored,
 * so it does not run it again).
 *
 * `changes` is the field `changes` of the event of GitHub, with what the edit changed
 * (due_on, description or title, each with `from`). `dispatch` false does not run the
 * workflows to join and leave: it is for after the join was made, to write the lines.
 */
export async function syncMilestone(
  {
    repository,
    milestone: title,
    changes,
    project,
    trainRepository,
    dispatch = true,
    override = false,
  },
  { octokit, log = () => {} },
) {
  const { oss, host } = repositoriesOf(repository);
  const actions = [];
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
    await call(
      `Updating the milestone ${found.title} of ${repo}`,
      octokit.rest.issues.updateMilestone({
        owner,
        repo: name,
        milestone_number: found.number,
        ...update,
      }),
    );
    Object.assign(found, {
      ...(update.due_on !== undefined && { due_on: update.due_on }),
      ...(update.description !== undefined && {
        description: update.description,
      }),
    });
    note(
      `${repo} ${found.title}: ${[
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

  // { line } is the error line if it cannot be joined, and nothing if it is in the train
  const join = async (version, destination, train) => {
    if (hashesOf(train, project, version).joined) {
      return {};
    }
    if (!(await releaseExists(version))) {
      note(
        `release/${version} does not exist, so it cannot join ${train.branch}`,
      );
      return { line: cannotJoin(train.branch, `release/${version}`) };
    }
    if (dispatch) {
      await run(JOIN_WORKFLOW, version, {
        "deployment-destination": destination,
        "release-train": train.branch,
        "release-train-repository": trainRepository,
      });
      note(`${version} joins the release train ${train.branch}`);
    }
    return {};
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
        note(`${version} leaves the release train ${name}`);
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

    let ossLine = "";
    let hotLine = "";
    let hotDate;
    let mirrorDate = null;
    let clearOss = false;
    if (name) {
      const train = await trainNamed(name);
      if (!train.found) {
        note(
          `The release train ${name} does not exist: the due date is cleared`,
        );
        ossLine = hotLine = missingTrain(name);
        clearOss = true;
        hotDate = null;
      } else {
        mirrorDate = date;
        const joined = await join(ossTitle, "Maven Central", train);
        ossLine = joined.line ?? trainLine(name);
        if (hotfix) {
          const availability = commercialAvailability(train);
          if (!availability) {
            hotLine = noAvailability(name);
          } else {
            hotDate = availability;
            const hotJoined = await join(hotTitle, "Spring Enterprise", train);
            hotLine = hotJoined.line ?? trainLine(name);
          }
        }
      }
    } else {
      hotDate = null;
    }

    await write(oss, found, {
      ...(clearOss && { date: null }),
      description: withFirstLine(found.description, ossLine),
    });
    if (mirror) {
      // the same first line as the OSS milestone, and the link to it after the text
      await write(host, mirror, {
        date: mirrorDate,
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
    const train = await trainNamed(name);
    if (!train.found) {
      note(`The release train ${name} does not exist: the due date is cleared`);
      await write(host, found, {
        date: null,
        description: withTrainLine(found.description, missingTrain(name)),
      });
      return;
    }
    const availability = commercialAvailability(train);
    if (!availability) {
      await write(host, found, {
        description: withTrainLine(found.description, noAvailability(name)),
      });
      return;
    }
    const joined = await join(ltsTitle, "Spring Enterprise", train);
    await write(host, found, {
      date: availability,
      description: withTrainLine(
        found.description,
        joined.line ?? trainLine(name),
      ),
    });
  };

  if (!RELEASE.test(title) && !HOTFIX.test(title)) {
    note(`${title} is not the version of a release: nothing to do`);
    return { actions };
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
  } else if (await isLts(octokit, host, title)) {
    await syncLts(title);
  } else {
    note(
      `${title} is not a milestone of OSS, and ${host} has no long-term support branch for it: nothing to do`,
    );
  }
  return { actions };
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
