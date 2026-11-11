import { trainOf, trainOfDate } from "./descriptions.js";
import { call, parseRepository } from "./octokit.js";
import { dateOf, hashesOf, readTrain } from "./trains.js";
import { candidateOf, openReleasesOf } from "./versions.js";

export const RELEASE_WORKFLOW = "release-branches.yml";
export const FREEZE_WORKFLOW = "code-freeze.yml";

const pause = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const VERSION_LINE = /^version=([^\r\n]*)/m;

/** The version of gradle.properties on a branch, or "" if there is none. */
async function versionOn(octokit, { owner, repo }, branch) {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: "gradle.properties",
      ref: branch,
    });
    const text = Buffer.from(data.content, "base64").toString("utf8");
    return VERSION_LINE.exec(text)?.[1]?.trim() ?? "";
  } catch (error) {
    if (error.status === 404) {
      return "";
    }
    throw error;
  }
}

/**
 * The embargoed branches of the commercial repository that the release workflow builds, and
 * the release that each one builds now:
 *
 * - embargoed/frozen/<generation> builds the release of its version (7.0.10-SNAPSHOT is
 *   7.0.10; a .0 version is the open milestone of it with the earliest due date), and the
 *   snapshot branch of it.
 * - embargoed/active/<generation> builds the hotfix of that release (7.0.10.1). A .0 version
 *   has one only for its GA.
 * - embargoed/lts/<generation> builds its own version (5.8.31).
 *
 * `train` is the name of the train that the release is due in, and "" if it has none: the
 * OSS milestone of the release (or of the release that a hotfix fixes) has its due date, and
 * a long-term support milestone names it in its description.
 */
export async function discover(octokit, { oss, host }) {
  const target = parseRepository(host);
  const names = (
    await call(
      `Reading the branches of ${host}`,
      octokit.paginate(octokit.rest.repos.listBranches, {
        ...target,
        per_page: 100,
      }),
    )
  ).map((b) => b.name);
  const milestones = async (repository) => {
    const { owner, repo } = parseRepository(repository);
    return call(
      `Reading the milestones of ${repository}`,
      octokit.paginate(octokit.rest.issues.listMilestones, {
        owner,
        repo,
        state: "all",
        per_page: 100,
      }),
    );
  };
  const ossMilestones = await milestones(oss);
  const hostMilestones = await milestones(host);
  const trainOfOss = (title) =>
    trainOfDate(dateOf(ossMilestones.find((m) => m.title === title)?.due_on));

  const items = [];
  const notes = [];
  const releases = new Map();
  for (const branch of names.filter((n) => n.startsWith("embargoed/frozen/"))) {
    const version = await versionOn(octokit, target, branch);
    let candidate;
    try {
      candidate = candidateOf(version);
    } catch {
      notes.push(`${branch} has no release version (${version || "none"})`);
      continue;
    }
    const release = candidate.endsWith(".0")
      ? (openReleasesOf(candidate, ossMilestones)[0] ?? "")
      : candidate;
    if (!release) {
      notes.push(`${branch} (${version}) has no open milestone in ${oss}`);
      continue;
    }
    const generation = branch.slice("embargoed/frozen/".length);
    releases.set(generation, { release, candidate });
    items.push({ kind: "frozen", branch, release, train: trainOfOss(release) });
  }
  for (const branch of names.filter((n) => n.startsWith("embargoed/active/"))) {
    const generation = branch.slice("embargoed/active/".length);
    const frozen = releases.get(generation);
    if (!frozen) {
      notes.push(`${branch} has no frozen branch to take its release from`);
      continue;
    }
    // a milestone or a release candidate of a .0 version has no hotfix
    if (
      frozen.candidate.endsWith(".0") &&
      frozen.release !== frozen.candidate
    ) {
      continue;
    }
    items.push({
      kind: "active",
      branch,
      release: `${frozen.release}.1`,
      train: trainOfOss(frozen.release),
    });
  }
  for (const branch of names.filter((n) => n.startsWith("embargoed/lts/"))) {
    const version = await versionOn(octokit, target, branch);
    let release;
    try {
      release = candidateOf(version);
    } catch {
      notes.push(`${branch} has no release version (${version || "none"})`);
      continue;
    }
    const milestone = hostMilestones.find((m) => m.title === release);
    items.push({
      kind: "lts",
      branch,
      release,
      train: trainOf(milestone?.description),
    });
  }
  return { items, notes };
}

/** Whether a run of the code freeze is going on in the commercial repository. */
async function freezeRunning(octokit, host) {
  const { owner, repo } = parseRepository(host);
  for (const status of ["in_progress", "queued"]) {
    try {
      const { data } = await octokit.rest.actions.listWorkflowRuns({
        owner,
        repo,
        workflow_id: FREEZE_WORKFLOW,
        status,
        per_page: 1,
      });
      if (data.total_count > 0) {
        return true;
      }
    } catch (error) {
      // a repository that has no code freeze workflow has no freeze going on
      if (error.status === 404) {
        return false;
      }
      throw error;
    }
  }
  return false;
}

/**
 * Starts the release workflow on a branch, and waits until its run has ended. The run is
 * the newest run by hand of that branch that was made since the start.
 */
async function startAndWait(
  octokit,
  host,
  branch,
  { sleep, intervalMs, timeoutMs },
) {
  const { owner, repo } = parseRepository(host);
  const started = Date.now();
  await call(
    `Starting ${RELEASE_WORKFLOW} on ${branch} of ${host}`,
    octokit.rest.actions.createWorkflowDispatch({
      owner,
      repo,
      workflow_id: RELEASE_WORKFLOW,
      ref: branch,
    }),
  );
  for (;;) {
    const { data } = await octokit.rest.actions.listWorkflowRuns({
      owner,
      repo,
      workflow_id: RELEASE_WORKFLOW,
      branch,
      event: "workflow_dispatch",
      per_page: 10,
    });
    const run = data.workflow_runs
      .filter((r) => Date.parse(r.created_at) >= started - 10_000)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
    if (run?.status === "completed") {
      return { conclusion: run.conclusion, url: run.html_url };
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(
        `The run of ${RELEASE_WORKFLOW} on ${branch} did not end in ${Math.round(timeoutMs / 60000)} minutes`,
      );
    }
    await sleep(intervalMs);
  }
}

/**
 * Rebuilds the release branches: starts the release workflow on the embargoed branches, which
 * builds `release/<version>` and the snapshot branch again from the pushed commit, with the
 * dependency updates of the release train if there is one, and joins it. The frozen and the
 * long-term support branches go first, in parallel, and the active ones after them, as a hotfix
 * has the release merged in and must find the new one.
 *
 * Nothing is rebuilt
 * - while the code freeze is running, as it marks releases ready and bumps the versions,
 * - for a release that is ready in its train, which cannot be changed any more.
 *
 * `only` limits it to some releases (7.0.10 and its hotfix 7.0.10.1). A branch that has
 * nothing to build is not an error: the run of the workflow ends with "Nothing to build". Only
 * a run that fails is a failure. With `dryRun` it says what it would do and starts nothing.
 */
export async function rebuildReleases(
  { repository, repositories, project, trainRepository, only, dryRun = false },
  {
    octokit,
    log = () => {},
    sleep = pause,
    intervalMs = 15000,
    timeoutMs = 90 * 60 * 1000,
  },
) {
  const { oss, host } = repositories;
  const results = [];
  const record = (item, result, reason = "") => {
    results.push({
      branch: item.branch,
      release: item.release,
      result,
      reason,
    });
    log(
      `${item.branch} (${item.release}): ${result}${reason ? `, ${reason}` : ""}`,
    );
  };
  if (await freezeRunning(octokit, host)) {
    log("The code freeze is running: nothing is rebuilt");
    return { results, skipped: "freeze" };
  }
  const { items, notes } = await discover(octokit, { oss, host });
  notes.forEach((n) => log(n));
  const trains = new Map();
  const trainOfItem = async (name) => {
    if (!trains.has(name)) {
      trains.set(name, await readTrain(octokit, trainRepository, name));
    }
    return trains.get(name);
  };
  const wanted = [];
  for (const item of items) {
    if (only && !only.includes(item.release)) {
      continue;
    }
    if (item.train) {
      const train = await trainOfItem(item.train);
      if (train.found && hashesOf(train, project, item.release).ready) {
        record(item, "skipped", `${item.release} is ready in ${item.train}`);
        continue;
      }
    }
    wanted.push(item);
  }
  const rebuild = async (item) => {
    if (dryRun) {
      record(item, "would rebuild");
      return;
    }
    try {
      const { conclusion, url } = await startAndWait(
        octokit,
        host,
        item.branch,
        {
          sleep,
          intervalMs,
          timeoutMs,
        },
      );
      if (conclusion === "success") {
        record(item, "rebuilt", url);
      } else {
        record(item, "failed", `the run ended as ${conclusion}: ${url}`);
      }
    } catch (error) {
      if (error.status === 404 || /404/.test(error.message)) {
        record(item, "skipped", `${RELEASE_WORKFLOW} is not on ${item.branch}`);
        return;
      }
      record(item, "failed", error.message);
    }
  };
  await Promise.all(
    wanted.filter((i) => i.kind !== "active").map((i) => rebuild(i)),
  );
  for (const item of wanted.filter((i) => i.kind === "active")) {
    await rebuild(item);
  }
  return { results };
}
