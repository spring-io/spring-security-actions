import { describe, expect, it } from "vitest";
import {
  trainOf,
  trainOfDate,
  withFirstLine,
  withLink,
  withTrainLine,
} from "../src/descriptions.js";

describe("trainOf", () => {
  it.each([
    ["Release Train: 2026.11.19", "2026.11.19"],
    ["Notes\nrelease train: 2026.11.19\nmore", "2026.11.19"],
    ["Release Train: nonsense", ""],
    ["ERROR: The Release Train 2026.11.19 doesn't exist", ""],
    ["", ""],
    [undefined, ""],
  ])("%j names the train %j", (description, train) => {
    expect(trainOf(description)).toBe(train);
  });
});

describe("trainOfDate", () => {
  it("is the branch of the train of a date", () => {
    expect(trainOfDate("2026-11-19")).toBe("2026.11.19");
    expect(trainOfDate("2026-11-19T12:00:00Z")).toBe("2026.11.19");
    expect(trainOfDate("")).toBe("");
  });
});

describe("withFirstLine", () => {
  it("sets the first line of an empty description", () => {
    expect(withFirstLine("", "Release Train: 2026.11.19")).toBe(
      "Release Train: 2026.11.19",
    );
  });

  it("replaces a train line or an error line, and keeps the text after it", () => {
    expect(
      withFirstLine(
        "Release Train: 2026.10.22\nNotes",
        "Release Train: 2026.11.19",
      ),
    ).toBe("Release Train: 2026.11.19\nNotes");
    expect(
      withFirstLine("ERROR: nope\n\nNotes", "Release Train: 2026.11.19"),
    ).toBe("Release Train: 2026.11.19\nNotes");
  });

  it("puts the line before text that is not a managed line", () => {
    expect(withFirstLine("Notes", "Release Train: 2026.11.19")).toBe(
      "Release Train: 2026.11.19\nNotes",
    );
  });

  it("takes the line out, and keeps the text", () => {
    expect(withFirstLine("Release Train: 2026.11.19\nNotes", "")).toBe("Notes");
    expect(withFirstLine("ERROR: nope", "")).toBe("");
    expect(withFirstLine("Notes", "")).toBe("Notes");
  });
});

describe("withTrainLine", () => {
  it("replaces the line wherever it is, and keeps the rest", () => {
    expect(
      withTrainLine(
        "5.8.30 LTS\nRelease Train: 2026.10.22\nSee notes",
        "ERROR: x",
      ),
    ).toBe("5.8.30 LTS\nERROR: x\nSee notes");
  });

  it("adds the line at the start if there is none, and takes it out", () => {
    expect(withTrainLine("Notes", "Release Train: 2026.11.19")).toBe(
      "Release Train: 2026.11.19\nNotes",
    );
    expect(withTrainLine("A\nRelease Train: 2026.11.19\nB", "")).toBe("A\nB");
  });
});

describe("withLink", () => {
  it("adds the link after the text, once", () => {
    const url = "https://github.com/x/y/milestone/1";
    const linked = withLink("Notes", url);
    expect(linked).toBe(`Notes\n\nOSS milestone: ${url}`);
    expect(withLink(linked, url)).toBe(linked);
    expect(withLink("", url)).toBe(`OSS milestone: ${url}`);
  });
});
