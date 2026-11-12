import { parse as parseYaml } from "yaml";
import { call, parseRepository } from "./octokit.js";

/**
 * Reads the state of a release train (train.yml of the branch named after its date) from
 * the release train repository. A branch that does not exist is no train: { found: false }.
 */
export async function readTrain(octokit, repository, branch) {
  const target = parseRepository(repository);
  await call(`Reading ${repository}`, octokit.rest.repos.get(target));
  try {
    await octokit.rest.repos.getBranch({ ...target, branch });
  } catch (error) {
    if (error.status === 404) {
      return { found: false, branch, train: {} };
    }
    throw new Error(
      `Reading the branch ${branch} of ${repository} failed with ${error.status} ${error.message}`,
    );
  }
  const { data } = await call(
    `Reading train.yml of ${branch} of ${repository}`,
    octokit.rest.repos.getContent({
      ...target,
      path: "train.yml",
      ref: branch,
    }),
  );
  const text = Buffer.from(data.content, "base64").toString("utf8");
  return { found: true, branch, train: parseYaml(text) ?? {} };
}

/** The hashes of the steps that a version of a project went through in a train. */
export const hashesOf = (train, project, version) =>
  train?.train?.releases?.[project]?.[version]?.["commit-hashes"] ?? {};

/**
 * The commercial general availability of a train (schedule.publication.
 * commercial-general-availability), YYYY-MM-DD, or "" if it has none. YAML reads a date as
 * a date, so only the date of it is kept.
 */
export function commercialAvailability(train) {
  const value =
    train?.train?.schedule?.publication?.["commercial-general-availability"];
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}

/**
 * The UTC date (YYYY-MM-DD) of a due date, or "" for none. GitHub answers with
 * 2026-11-19T00:00:00Z, but the previous due date of an edit (changes.due_on.from) comes in the
 * time zone of the one who edited: 2026-11-18T18:00:00.000-06:00 is the same instant, and its
 * first ten characters are the day before. It is read as an instant.
 */
export function dateOf(value) {
  if (!value) {
    return "";
  }
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? "" : time.toISOString().slice(0, 10);
}

// A milestone is due at noon UTC, which is the same day in every time zone.
export const noon = (date) => `${date}T12:00:00Z`;
