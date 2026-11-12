/**
 * The lines of a milestone description that the handler writes. A description has, as its
 * first line, `Release Train: 2026.11.19` or an error line, and may have other text after it
 * (an OSS milestone has notes). An error line starts with ERROR:.
 */

const TRAIN_LINE = /^\s*Release Train:\s*(\S+)\s*$/im;
const MANAGED_LINE = /^\s*(Release Train:|ERROR:)/i;
const RELEASE_TRAIN = /^\d{4}\.\d{2}\.\d{2}$/;

/** The line that says the release is in a train. */
export const trainLine = (train) => `Release Train: ${train}`;

export const cannotLeave = (train) =>
  `ERROR: Cannot leave the Release Train ${train}: it is ready`;

export const noAvailability = (train) =>
  `ERROR: The Release Train ${train} has no commercial-general-availability`;

export const linkLine = (url) => `OSS milestone: ${url}`;

/** The name of the train that a description names with `Release Train: <name>`, or "". */
export function trainOf(description) {
  const match = TRAIN_LINE.exec(description ?? "");
  return match && RELEASE_TRAIN.test(match[1]) ? match[1] : "";
}

/** The train of a date, `2026-11-19` gives `2026.11.19`, or "" for no date. */
export function trainOfDate(date) {
  return date ? date.slice(0, 10).replaceAll("-", ".") : "";
}

/**
 * The description with its first line, the one that the handler manages, set to `line` (or
 * taken out, if there is none). The first line is managed if it is a train line or an
 * error line. The text after it is kept, and a description that starts with other text gets
 * the line before it.
 */
export function withFirstLine(description, line) {
  const text = description ?? "";
  const lines = text.split(/\r?\n/);
  const rest = MANAGED_LINE.test(lines[0] ?? "")
    ? lines.slice(1).join("\n").replace(/^\n+/, "")
    : text;
  if (!line) {
    return rest;
  }
  return rest.trim() === "" ? line : `${line}\n${rest}`;
}

/**
 * The description with the line that names the train (or the error line that took its
 * place) replaced by `line`, wherever it is, or taken out if there is none. A description
 * that has no such line gets the new one at the start. It is what the person who owns a
 * long-term support milestone writes, so the rest of the text is left as it is.
 */
export function withTrainLine(description, line) {
  const text = description ?? "";
  const lines = text.split(/\r?\n/);
  const index = lines.findIndex(
    (l) => TRAIN_LINE.test(l) || /^\s*ERROR:/i.test(l),
  );
  if (index === -1) {
    return line ? (text.trim() === "" ? line : `${line}\n${text}`) : text;
  }
  if (line) {
    lines[index] = line;
  } else {
    lines.splice(index, 1);
  }
  return lines.join("\n");
}

/** The description with the link to the OSS milestone added after its text, if it has none. */
export function withLink(description, url) {
  const text = description ?? "";
  if (text.includes(url)) {
    return text;
  }
  return text.trim() === ""
    ? linkLine(url)
    : `${text.trimEnd()}\n\n${linkLine(url)}`;
}
