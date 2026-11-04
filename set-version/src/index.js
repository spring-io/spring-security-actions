import fs from "node:fs";
import path from "node:path";
import * as core from "@actions/core";
import { git, requireIdentity } from "./git.js";
import { execute, isMain } from "./run.js";

const VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]*$/;
const LINE = /^version=([^\r\n]*)/m;

/** The content of a file, or undefined if there is no such file. */
function readIfExists(file, encoding) {
  try {
    return fs.readFileSync(file, encoding);
  } catch (error) {
    if (error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

/**
 * Sets the version of a properties file (gradle.properties) and commits it, as a commit of
 * its own, signed off with the identity that git is set up with. Only the line version=...
 * changes: the other properties, and the line endings, stay. It fails if the file has no
 * such line, or if the version is that already (there would be nothing to commit).
 *
 * It returns the commit.
 */
export function setVersion({
  directory,
  version,
  message,
  file = "gradle.properties",
}) {
  if (!VERSION.test(version ?? "")) {
    throw new Error(`${version} is not a version to write`);
  }
  if (!message) {
    throw new Error("The input message is required");
  }
  const full = path.resolve(directory, file);
  const text = readIfExists(full, "utf8");
  if (text === undefined) {
    throw new Error(`${file} does not exist, in ${path.resolve(directory)}`);
  }
  const current = LINE.exec(text);
  if (!current) {
    throw new Error(`${file} has no line version=...`);
  }
  if (current[1] === version) {
    throw new Error(
      `${file} has the version ${version} already, there is nothing to commit`,
    );
  }
  requireIdentity(directory);

  fs.writeFileSync(
    full,
    text.replace(LINE, () => `version=${version}`),
  );
  const relative = path.relative(path.resolve(directory), full);
  git(directory, "add", "--", relative);
  git(
    directory,
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "--signoff",
    "--message",
    message,
    "--",
    relative,
  );
  return git(directory, "rev-parse", "HEAD");
}

export async function main() {
  const commit = setVersion({
    directory: core.getInput("path") || ".",
    version: core.getInput("version", { required: true }),
    message: core.getInput("message", { required: true }),
    file: core.getInput("file") || "gradle.properties",
  });
  core.info(
    `${commit.slice(0, 7)} ${core.getInput("message")} (version=${core.getInput("version")})`,
  );
  core.setOutput("commit", commit);
}

if (isMain(import.meta.url)) {
  execute(main);
}
