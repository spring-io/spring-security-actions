import { describe, expect, it } from "vitest";
import { isOwnEdit, parseChanges, verdictOf } from "../src/index.js";
import { HOST, fakeGitHub, milestone } from "./support/fake.js";

describe("parseChanges", () => {
  it("is nothing for a run by hand", () => {
    expect(parseChanges("")).toBeUndefined();
    expect(parseChanges("null")).toBeUndefined();
    expect(parseChanges("{}")).toBeUndefined();
    expect(parseChanges(undefined)).toBeUndefined();
  });

  it("is the changes of the event", () => {
    expect(parseChanges('{"due_on":{"from":"2026-11-19T00:00:00Z"}}')).toEqual({
      due_on: { from: "2026-11-19T00:00:00Z" },
    });
    expect(parseChanges('{"due_on":{"from":null}}')).toEqual({
      due_on: { from: null },
    });
  });

  it("fails for what is not JSON", () => {
    expect(() => parseChanges("{nope")).toThrow(/not JSON/);
  });
});

describe("isOwnEdit", () => {
  it("is whether the sender is the user of the token, in any case", async () => {
    const octokit = fakeGitHub({ user: "Release-Bot" });
    expect(await isOwnEdit(octokit, "release-bot")).toBe(true);
    expect(await isOwnEdit(octokit, "alice")).toBe(false);
    expect(await isOwnEdit(octokit, "")).toBe(false);
  });

  it("is not, if the token cannot say who it is", async () => {
    const octokit = fakeGitHub();
    octokit.rest.users.getAuthenticated = async () => {
      throw Object.assign(new Error("Forbidden"), { status: 403 });
    };
    expect(await isOwnEdit(octokit, "release-bot")).toBe(false);
  });
});

describe("verdictOf", () => {
  const github = (description, user = "release-bot") =>
    fakeGitHub({
      user,
      milestones: { [HOST]: [milestone(HOST, "5.8.30", { description })] },
    });
  const verdict = (octokit, sender) =>
    verdictOf(octokit, { repository: HOST, milestone: "5.8.30", sender });

  it("runs for an edit of anyone but the user of the token", async () => {
    expect(await verdict(github("!notes"), "alice")).toEqual({
      skip: false,
      override: false,
    });
  });

  it("leaves alone an edit of the user of the token", async () => {
    expect(await verdict(github("notes"), "release-bot")).toEqual({
      skip: true,
      override: false,
    });
  });

  it("runs for an edit of the user of the token whose description starts with !", async () => {
    expect(
      await verdict(github("!Release Train: 2026.11.19"), "release-bot"),
    ).toEqual({
      skip: false,
      override: true,
    });
  });

  it("runs for an edit whose description is just !, with nothing after it", async () => {
    expect(await verdict(github("!"), "release-bot")).toEqual({
      skip: false,
      override: true,
    });
  });

  it("does not take a ! that is not the first character, or a milestone that is not there, as a request", async () => {
    expect(await verdict(github("notes !"), "release-bot")).toMatchObject({
      skip: true,
    });
    expect(await verdict(github(" !notes"), "release-bot")).toMatchObject({
      skip: true,
    });
    const empty = fakeGitHub({ milestones: { [HOST]: [] } });
    expect(await verdict(empty, "release-bot")).toMatchObject({ skip: true });
  });
});
