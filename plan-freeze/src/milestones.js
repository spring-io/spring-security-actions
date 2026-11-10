import { candidateOf, openReleasesOf } from "./versions.js";

/**
 * The milestones of one branch that a code freeze closes, deletes and makes, besides the
 * ones of the releases it marks ready (those are in the plan as `releases`).
 *
 * The active embargoed branch is at the version of the release that the frozen branch builds
 * now (7.0.9-SNAPSHOT), so its fixes are tracked in two milestones of the commercial
 * repository: the hotfix (7.0.9.1), and the next release of OSS (7.0.10). The CVE issues are
 * in them. A freeze from 7.0.9-SNAPSHOT to 7.0.10-SNAPSHOT:
 *
 * - closes the tracker of the next release (commercial 7.0.10), and deletes it if it has no
 *   issues. The OSS release of it is made after this freeze, from the frozen branch that
 *   now has the fixes, and its issues are copied to OSS then.
 * - makes OSS 7.0.10, and the two that track the fixes of the new active branch: commercial
 *   7.0.10.1 and 7.0.11. A milestone that is there already is not made again.
 * - adds the link to the new OSS milestone to the commercial 7.0.10, if it is not deleted.
 *
 * A .0 version that is not made as the GA (7.0.0-M1, 7.0.0-RC1) keeps its version, and makes
 * nothing in OSS: the next milestone, release candidate or GA is planned by people. Its
 * tracker is the milestone after the one that is made (7.0.0-RC1 while 7.0.0-M1 is made):
 * it is closed, and the tracker of the one after it is made in the commercial repository,
 * only if that milestone exists in OSS already.
 *
 * What is expected and not found is not an error (a project that has not been through a
 * freeze with this has none of them): it is a warning, and nothing is done for it. A
 * milestone of a hotfix that is not made (the active branch has nothing that frozen lacks)
 * is a tracker too, and is deleted if it has no issues.
 *
 * It returns { trackers, creates, links, warnings }:
 *
 * - trackers: milestones to close or delete, shaped like the releases of the plan, with
 *   `deleteIfEmpty: true`
 * - creates: { repository, title, exists, description? } to make if they do not exist
 * - links: { repository, title, ossRepository, ossTitle } the commercial milestone that
 *   gets the link to the OSS one, if it is still there once the trackers are closed
 */
export function planMilestones({
  generation,
  candidate,
  current,
  next,
  releaseVersion,
  hotfix,
  differs,
  ossMilestones,
  commercialMilestones,
  ossRepository,
  hostRepository,
  milestoneOf,
}) {
  const result = { trackers: [], creates: [], links: [], warnings: [] };
  const has = (milestones, title) => milestones.some((m) => m.title === title);

  // a tracker to close: false (and a warning) if the commercial repository has none
  const track = (title, quiet = false) => {
    const milestone = milestoneOf(commercialMilestones, hostRepository, title);
    if (!milestone) {
      if (!quiet) {
        result.warnings.push(
          `${hostRepository} has no milestone ${title}, which tracks the fixes of ${generation}: there is nothing to close`,
        );
      }
      return false;
    }
    result.trackers.push({
      version: title,
      tracker: true,
      deleteIfEmpty: true,
      of: [generation],
      milestone,
    });
    return true;
  };
  const create = (repository, title, description) => {
    const milestones =
      repository === ossRepository ? ossMilestones : commercialMilestones;
    result.creates.push({
      repository,
      title,
      exists: has(milestones, title),
      ...(description && { description }),
    });
  };

  // the milestone of a hotfix that is not made has nothing to say
  if (hotfix && !differs) {
    track(hotfix, true);
  }

  if (next !== current) {
    const title = candidateOf(next);
    const [major, minor, patch] = title.split(".").map(Number);
    const tracked = track(title);
    create(ossRepository, title);
    create(hostRepository, `${title}.1`);
    create(hostRepository, `${major}.${minor}.${patch + 1}`);
    if (tracked) {
      result.links.push({
        repository: hostRepository,
        title,
        ossRepository,
        ossTitle: title,
      });
    }
    return result;
  }

  // a .0 version that is not made as the GA stays at its version
  const open = openReleasesOf(candidate, ossMilestones);
  const [, after, afterThat] = open;
  if (!after) {
    result.warnings.push(
      `${ossRepository} has no open milestone for ${candidate} after ${releaseVersion}: one is needed for the next freeze, and for the fixes of ${generation}`,
    );
    return result;
  }
  if (track(after)) {
    result.links.push({
      repository: hostRepository,
      title: after,
      ossRepository,
      ossTitle: after,
    });
  }
  if (afterThat) {
    const url = ossMilestones.find((m) => m.title === afterThat)?.html_url;
    create(
      hostRepository,
      afterThat,
      url ? `OSS milestone: ${url}` : undefined,
    );
  }
  return result;
}
