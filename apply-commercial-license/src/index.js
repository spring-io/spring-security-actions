import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@actions/core";
import { git, requireIdentity } from "./git.js";
import {
  checkstyleHeader,
  kindOf,
  rewriteHeader,
  suppressedBy,
  yearsOf,
} from "./headers.js";
import { execute, isMain } from "./run.js";

/**
 * The files whose header is changed, as git pathspecs: the sources of the Spring projects
 * (Java, AspectJ, Groovy, Kotlin, the JavaScript of Spring Security, and the build files),
 * and the XML and the properties files. gradlew and gradlew.bat have the header of Gradle,
 * which is not ours to change, and are not named.
 */
export const DEFAULT_HEADER_FILES = [
  "*.java",
  "*.aj",
  "*.groovy",
  "*.kt",
  "*.js",
  "*.gradle",
  "*.gradle.kts",
  "*.properties",
  "*.xml",
  "*.tld",
];

export const CHECKSTYLE_HEADER = "etc/checkstyle/header.txt";
export const LICENSE_SCRIPT = "gradle/broadcom-license.gradle";

// The commercial license, which is bundled with the action: it is the file LICENSE.txt
// next to action.yml. The program is in src/apply-commercial-license/ or in
// dist/apply-commercial-license/, the same depth, so it is found from both.
const BUNDLED = (file) =>
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "apply-commercial-license",
    file,
  );
export const BUNDLED_LICENSE = BUNDLED("LICENSE.txt");
// The script that sets the license of the POM, which is bundled the same way
export const BUNDLED_LICENSE_SCRIPT = BUNDLED("broadcom-license.gradle");

/**
 * The path of the license in the repository, relative to it. It is the given one, or the
 * file of the root of the repository that git tracks and that is named LICENSE*
 * (LICENSE, LICENSE.txt, LICENSE.md): the license of a module that is deeper is not it.
 * With several, LICENSE and then LICENSE.txt are preferred, and with no other choice it
 * fails and says to give the path. With none, it is LICENSE.txt, which is made.
 */
export function licenseTargetOf(directory, given = "") {
  if (given) {
    const full = path.resolve(directory, given);
    const relative = path.relative(path.resolve(directory), full);
    if (
      relative === "" ||
      relative.startsWith("..") ||
      path.isAbsolute(relative)
    ) {
      throw new Error(`The license target ${given} is not in the repository`);
    }
    return relative.split(path.sep).join("/");
  }
  const found = git(directory, "ls-files", "-z", "--", ":(glob)LICENSE*")
    .split("\0")
    .filter(Boolean);
  if (found.length === 0) {
    return "LICENSE.txt";
  }
  for (const preferred of ["LICENSE", "LICENSE.txt"]) {
    if (found.includes(preferred)) {
      return preferred;
    }
  }
  if (found.length === 1) {
    return found[0];
  }
  throw new Error(
    `The repository has several licenses (${found.join(", ")}): give the one to replace as the input license-target`,
  );
}

/**
 * Where the license is written: the target, or, if it is a symbolic link, the file that it
 * points to, so that a license that is repeated in several modules as links to one file
 * is written once. It is relative to the repository.
 */
function writableLicense(directory, target) {
  const full = path.join(directory, target);
  let stat;
  try {
    stat = fs.lstatSync(full);
  } catch {
    return target;
  }
  if (!stat.isSymbolicLink()) {
    return target;
  }
  let real;
  try {
    real = fs.realpathSync(full);
  } catch {
    throw new Error(`${target} is a link to a file that does not exist`);
  }
  const relative = path.relative(fs.realpathSync(directory), real);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${target} is a link to a file outside the repository`);
  }
  return relative.split(path.sep).join("/");
}

/** The text of a file, and the encoding that it has: .properties files can be ISO-8859-1. */
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

function readText(full) {
  const raw = fs.readFileSync(full);
  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(raw),
      encoding: "utf8",
    };
  } catch {
    return { text: raw.toString("latin1"), encoding: "latin1" };
  }
}

/** The root build file that applies the script of the license: build.gradle, or the .kts one. */
function rootBuildFileOf(directory) {
  for (const name of ["build.gradle", "build.gradle.kts"]) {
    if (fs.existsSync(path.join(directory, name))) {
      return name;
    }
  }
  throw new Error(
    "The repository has no build.gradle or build.gradle.kts in its root to apply the Broadcom license of the POM from",
  );
}

/**
 * Makes the build apply the script that sets the license of the POM to Broadcom's: the
 * script is gradle/broadcom-license.gradle, and the root build file gets a line at its end
 * that applies it. Gradle only reads the init.d of a project if the build copies it to
 * ~/.gradle/init.d, which not every build does, and this works for all of them. Both the
 * script and the line are left as they are if they are there. It returns the files that it
 * changed.
 */
function applyPomLicense(directory, scriptFile, log) {
  const rootBuild = rootBuildFileOf(directory);
  const changed = [];
  const script = fs.readFileSync(scriptFile);
  const scriptPath = path.join(directory, LICENSE_SCRIPT);
  const existingScript = readIfExists(scriptPath);
  if (existingScript === undefined || !existingScript.equals(script)) {
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    fs.writeFileSync(scriptPath, script);
    changed.push(LICENSE_SCRIPT);
    log(`${LICENSE_SCRIPT}: the Broadcom license of the POM`);
  }
  const buildPath = path.join(directory, rootBuild);
  const { text, encoding } = readText(buildPath);
  if (!text.includes("broadcom-license.gradle")) {
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const line = rootBuild.endsWith(".kts")
      ? `apply(from = "$rootDir/${LICENSE_SCRIPT}")`
      : `apply from: "$rootDir/${LICENSE_SCRIPT}"`;
    const separator = text.endsWith("\n") || text === "" ? "" : eol;
    fs.writeFileSync(
      buildPath,
      Buffer.from(text + separator + line + eol, encoding),
    );
    changed.push(rootBuild);
    log(`${rootBuild}: applies ${LICENSE_SCRIPT}`);
  }
  return changed;
}

/**
 * Changes the files of a git repository to the commercial ones, which is only done for a
 * hotfix (or for the code that becomes long-term support): the license header of the
 * source files (headerFiles) in one canonical shape with one year for the project, the
 * checkstyle header if the project has one, the license of the project, and the license of
 * the POM. It returns what it changed. If it is given a message, it commits that, signed
 * off, as the identity that git is set up with.
 *
 * The year is the one given, or the oldest year of the copyright of the project in the
 * headers (those of other holders do not count). The files that a suppression of
 * checkstyle covers entirely are third-party code, and are not changed.
 */
export function applyCommercialLicense({
  directory,
  licenseFile = BUNDLED_LICENSE,
  licenseScript = BUNDLED_LICENSE_SCRIPT,
  licenseTarget = "",
  headerFiles = DEFAULT_HEADER_FILES,
  year = "",
  commitMessage = "",
  log = () => {},
}) {
  if (!fs.existsSync(licenseFile)) {
    throw new Error(`The license does not exist: ${licenseFile}`);
  }
  // before anything is changed, so a failure here changes nothing
  const target = writableLicense(
    directory,
    licenseTargetOf(directory, licenseTarget),
  );
  rootBuildFileOf(directory);

  const tracked = (...pathspecs) =>
    pathspecs.length === 0
      ? []
      : git(directory, "ls-files", "-z", "--", ...pathspecs)
          .split("\0")
          .filter(Boolean);
  const suppressions = tracked(
    ":(glob)**/checkstyle-suppressions.xml",
    ":(glob)**/suppressions.xml",
  ).map((file) => fs.readFileSync(path.join(directory, file), "utf8"));
  const suppressed = suppressedBy(suppressions);
  const sources = tracked(...headerFiles).filter((file) => !suppressed(file));

  let canonical = String(year || "");
  const checkstyleFile = path.join(directory, CHECKSTYLE_HEADER);
  if (!canonical) {
    const found = sources.flatMap((file) => {
      const kind = kindOf(file);
      return kind
        ? yearsOf(readText(path.join(directory, file)).text, kind)
        : [];
    });
    if (found.length > 0) {
      canonical = String(Math.min(...found));
    } else if (!fs.existsSync(checkstyleFile)) {
      canonical = "";
    } else {
      throw new Error(
        "No header with a copyright year was found to take the year of the project from: give the input year",
      );
    }
  }
  if (!/^(\d{4})?$/.test(canonical)) {
    throw new Error(`The year ${canonical} is not a year`);
  }

  const changed = [];
  for (const file of sources) {
    const kind = kindOf(file);
    if (!kind || !canonical) {
      continue;
    }
    const full = path.join(directory, file);
    const { text, encoding } = readText(full);
    const rewritten = rewriteHeader(text, kind, canonical);
    if (rewritten !== text) {
      fs.writeFileSync(full, Buffer.from(rewritten, encoding));
      changed.push(file);
      log(`${file}: the Broadcom header`);
    }
  }
  const headers = changed.length;
  const java = changed.filter((file) => file.endsWith(".java")).length;

  const full = path.join(directory, target);
  const license = fs.readFileSync(licenseFile);
  const existing = readIfExists(full);
  const had = existing !== undefined;
  if (!had || !existing.equals(license)) {
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, license);
    changed.push(target);
    log(`${target}: the commercial license${had ? "" : " (it had none)"}`);
  }

  // The checkstyle header is only written if the project has one: not every project
  // checks the headers (Spring Security Kerberos does not).
  const checkstyle = canonical
    ? readIfExists(checkstyleFile, "utf8")
    : undefined;
  if (checkstyle !== undefined) {
    const header = checkstyleHeader(canonical);
    if (checkstyle !== header) {
      fs.writeFileSync(checkstyleFile, header);
      changed.push(CHECKSTYLE_HEADER);
      log(
        `${CHECKSTYLE_HEADER}: the header of the Broadcom license, ${canonical}`,
      );
    }
  }

  const pom = applyPomLicense(directory, licenseScript, log);
  changed.push(...pom);

  let commit = "";
  if (commitMessage && changed.length > 0) {
    requireIdentity(directory);
    git(directory, "add", "--", ...changed);
    git(
      directory,
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--signoff",
      "--message",
      commitMessage,
      "--",
      ...changed,
    );
    commit = git(directory, "rev-parse", "HEAD");
    log(`Committed ${commit.slice(0, 7)}: ${commitMessage}`);
  }
  return {
    changed,
    headers,
    java,
    license: changed.includes(target),
    pom: pom.length > 0,
    year: canonical,
    commit,
  };
}

export async function main() {
  const headerFiles = core
    .getInput("header-files")
    .split(/\s+/)
    .filter(Boolean);
  const result = applyCommercialLicense({
    directory: core.getInput("path") || ".",
    licenseFile: core.getInput("license-file") || BUNDLED_LICENSE,
    licenseTarget: core.getInput("license-target"),
    headerFiles: headerFiles.length > 0 ? headerFiles : DEFAULT_HEADER_FILES,
    year: core.getInput("year"),
    commitMessage: core.getInput("commit-message"),
    log: (line) => core.info(line),
  });
  core.info(
    `${result.headers} headers and ${result.license ? "the license" : "no license"} changed, year ${result.year || "none"}`,
  );
  core.setOutput("headers", String(result.headers));
  core.setOutput("java-files", String(result.java));
  core.setOutput("license", String(result.license));
  core.setOutput("pom-license", String(result.pom));
  core.setOutput("year", result.year);
  core.setOutput("changed", JSON.stringify(result.changed));
  core.setOutput("commit", result.commit);
}

if (isMain(import.meta.url)) {
  execute(main);
}
