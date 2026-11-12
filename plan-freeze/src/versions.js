const SNAPSHOT = "-SNAPSHOT";

/**
 * The version a snapshot version is going to be released as, before looking at the
 * milestones: 7.0.1-SNAPSHOT gives 7.0.1.
 */
export function candidateOf(snapshotVersion) {
  const version = (snapshotVersion ?? "").trim();
  if (!version.endsWith(SNAPSHOT)) {
    throw new Error(
      `"${version}" is not a snapshot version: it must end with ${SNAPSHOT}`,
    );
  }
  const candidate = version.slice(0, -SNAPSHOT.length);
  if (!/^\d+\.\d+\.\d+$/.test(candidate)) {
    throw new Error(
      `"${version}" cannot be frozen: expected <major>.<minor>.<patch>${SNAPSHOT}`,
    );
  }
  return candidate;
}

/**
 * The next development version of a branch: the last segment plus one (7.0.5-SNAPSHOT gives
 * 7.0.6-SNAPSHOT). A .0 version is the exception: 7.2.0-SNAPSHOT is released as milestones
 * and release candidates first, and stays until the release that is made is the GA
 * (7.2.0 itself). Then the next is 7.2.1-SNAPSHOT. It is decided by the release that is made
 * (`releaseVersion`, see releaseVersionOf), and not by whether a milestone 7.2.0 exists: that
 * one may be created early, while 7.2.0-RC1 is made, and the version must stay.
 */
export function nextVersion(current, releaseVersion) {
  const candidate = candidateOf(current);
  const [major, minor, patch] = candidate.split(".").map(Number);
  if (patch === 0) {
    return releaseVersion === candidate
      ? `${major}.${minor}.1${SNAPSHOT}`
      : current;
  }
  return `${major}.${minor}.${patch + 1}${SNAPSHOT}`;
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The order of the releases of a version: its milestones, then its release candidates,
// then the version itself.
function releaseOrder(title, candidate) {
  const match = title.slice(candidate.length).match(/^-(M|RC)(\d+)$/);
  if (!match) {
    return [2, 0];
  }
  return [match[1] === "M" ? 0 : 1, Number(match[2])];
}

/**
 * The version that a snapshot version is released as, as compute-release-version works it
 * out, so that the release branch it names is the one that the release workflow built:
 *
 * - 7.0.5-SNAPSHOT is released as 7.0.5.
 * - 7.2.0-SNAPSHOT is released as one of its milestones (7.2.0-M2), release candidates
 *   (7.2.0-RC1) or 7.2.0 itself: the open milestone with the earliest due date of those.
 *
 * It returns "" for a .0 version that has no open milestone. `milestones` are the milestones
 * of the repository, each with title, state and due_on.
 */
export function releaseVersionOf(candidate, milestones) {
  if (!candidate.endsWith(".0")) {
    return candidate;
  }
  return openReleasesOf(candidate, milestones)[0] ?? "";
}

/**
 * The titles of the open milestones of a .0 version, in the order that they are released:
 * the milestones and release candidates (7.2.0-M2, 7.2.0-RC1) and 7.2.0 itself, by due date
 * (one with no due date is last), and for one day milestones, then release candidates, then
 * the version. The first is the release that is made now (releaseVersionOf).
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
 * The version of the hotfix of a release: the release and .1 (7.0.5 gives 7.0.5.1). A .0
 * version has a hotfix only for its GA (7.2.0), and not for its milestones and release
 * candidates. It is "" if there is none.
 */
export function hotfixOf(candidate, releaseVersion) {
  if (!releaseVersion) {
    return "";
  }
  if (candidate.endsWith(".0") && releaseVersion !== candidate) {
    return "";
  }
  return `${releaseVersion}.1`;
}
