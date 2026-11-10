import { describe, expect, it } from "vitest";
import { isOwnEdit, parseChanges } from "../src/index.js";
import { fakeGitHub } from "./support/fake.js";

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
