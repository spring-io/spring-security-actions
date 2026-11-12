const SNAPSHOT = "-SNAPSHOT";
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The version that a snapshot version is going to be released as: 7.0.10-SNAPSHOT is 7.0.10. */
export function candidateOf(snapshotVersion) {
  const version = (snapshotVersion ?? "").trim();
  if (!version.endsWith(SNAPSHOT)) {
    throw new Error(`"${version}" is not a snapshot version`);
  }
  const candidate = version.slice(0, -SNAPSHOT.length);
  if (!/^\d+\.\d+\.\d+$/.test(candidate)) {
    throw new Error(
      `"${version}" has no release: expected <major>.<minor>.<patch>${SNAPSHOT}`,
    );
  }
  return candidate;
}

// The order of the releases of a .0 version: milestones, then release candidates, then the GA.
function releaseOrder(title, candidate) {
  const match = title.slice(candidate.length).match(/^-(M|RC)(\d+)$/);
  if (!match) {
    return [2, 0];
  }
  return [match[1] === "M" ? 0 : 1, Number(match[2])];
}

/**
 * The titles of the open milestones of a .0 version in the order that they are released
 * (7.2.0-M2, 7.2.0-RC1, 7.2.0), by due date (none is last), and for one day milestones, then
 * release candidates, then the GA.
 */
export function openReleasesOf(candidate, milestones) {
  const pattern = new RegExp(`^${escapeRegExp(candidate)}(-(M|RC)\\d+)?$`);
  const dueOf = (m) => (m.due_on ? Date.parse(m.due_on) : Infinity);
  return milestones
    .filter((m) => m.state === "open" && pattern.test(m.title))
    .sort((a, b) => {
      const dueA = dueOf(a);
      const dueB = dueOf(b);
      if (dueA !== dueB) {
        return dueA < dueB ? -1 : 1;
      }
      const [kindA, numberA] = releaseOrder(a.title, candidate);
      const [kindB, numberB] = releaseOrder(b.title, candidate);
      return kindA - kindB || numberA - numberB;
    })
    .map((m) => m.title);
}

/**
 * The state that the milestones of a branch have to be in, from its version, which is the one
 * after a code freeze has bumped it: the version that the frozen branch builds next, in
 * `gradle.properties`. `ossMilestones` are the milestones of the OSS repository, and `closing`
 * the titles of them that a freeze closes, and are taken as closed.
 *
 * The active branch is at the version of the release that the frozen branch builds now, so its
 * fixes ship twice: in the hotfix of that release, and in the next release of OSS. Both are
 * milestones of the commercial repository that track the fixes (the trackers). For the version
 * 7.0.10 (the one before it was 7.0.9, P):
 *
 * - closed: OSS 7.0.9, commercial 7.0.9.1 (the hotfix of the one before) and commercial 7.0.10
 *   (the tracker of the release that the frozen branch has the fixes for: it ships next),
 * - there: OSS 7.0.10, commercial 7.0.10.1 and 7.0.11 (the trackers of the new active branch),
 * - linked: commercial 7.0.10 has the link to OSS 7.0.10.
 *
 * It is the same state before the freeze (7.0.9) and after it (7.0.10), so a run of it, by the
 * freeze or by hand, is right for the version that the branch has now. A .0 version stays the
 * same until its GA, so the milestones decide: the release that is made next is the open
 * milestone of it with the earliest due date. Before the GA there is no hotfix and nothing
 * in OSS to make: the tracker of that release is closed, and the tracker of the one after it
 * is made, if it exists in OSS. The GA is like any release. Long-term support has only the
 * release before it, commercial, which is closed.
 *
 * It returns { close, make, link, warnings }. Each is an array of { repository, title }, with
 * the repository "oss" or "host" (the commercial one). `make` may have a `link` (it gets the
 * link to the OSS milestone of the same title) and `link` is { title } of a commercial
 * milestone that gets the link.
 */
export function wantedFor({
  version,
  ossMilestones = [],
  closing = [],
  lts = false,
}) {
  const candidate = candidateOf(version);
  const [major, minor, patch] = candidate.split(".").map(Number);
  const wanted = { close: [], make: [], link: [], warnings: [] };
  const closeIt = (repository, title) =>
    wanted.close.push({ repository, title });
  const makeIt = (repository, title, extra = {}) =>
    wanted.make.push({ repository, title, ...extra });

  if (lts) {
    if (patch > 0) {
      closeIt("host", `${major}.${minor}.${patch - 1}`);
    }
    return wanted;
  }

  // the release that is made next, and whether the version before it has a patch
  let release = candidate;
  if (patch === 0) {
    const state = ossMilestones.map((m) =>
      closing.includes(m.title) ? { ...m, state: "closed" } : m,
    );
    const open = openReleasesOf(candidate, state);
    release = open[0];
    if (!release) {
      wanted.warnings.push(
        `the OSS repository has no open milestone for ${candidate}, one of ${candidate}, ${candidate}-M<n> and ${candidate}-RC<n>`,
      );
      return wanted;
    }
    if (release !== candidate) {
      // a milestone or a release candidate: no hotfix, and nothing is made in OSS (people plan them)
      closeIt("host", release);
      wanted.link.push({ title: release });
      if (open[1]) {
        makeIt("host", open[1], { link: true });
      } else {
        wanted.warnings.push(
          `no open milestone for ${candidate} after ${release}: one is needed for the fixes after it`,
        );
      }
      return wanted;
    }
  }

  if (patch > 0) {
    const before = `${major}.${minor}.${patch - 1}`;
    closeIt("oss", before);
    closeIt("host", `${before}.1`);
  }
  closeIt("host", release);
  makeIt("oss", release);
  makeIt("host", `${release}.1`);
  makeIt("host", `${major}.${minor}.${patch + 1}`);
  wanted.link.push({ title: release });
  return wanted;
}
