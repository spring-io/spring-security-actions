const SNAPSHOT = "-SNAPSHOT";
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The version a snapshot version is going to be released as: 7.0.9-SNAPSHOT gives 7.0.9. */
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

// The order of the releases of a version: milestones, then release candidates, then the version.
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
 * release candidates, then the version. The first is the release that is made now.
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
