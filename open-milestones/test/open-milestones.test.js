import { describe, expect, it } from "vitest";
import { linkLine, openMilestones, withLink } from "../src/index.js";

const oss = "spring-projects/spring-security";
const commercial = "spring-projects/spring-security-commercial";

/** The milestones that GitHub has: { repository: [{ number, title, state, description }] }. */
function fakeOctokit(milestones, { failOn } = {}) {
  const created = [];
  const updated = [];
  let next = 100;
  const list = (owner, repo) => milestones[`${owner}/${repo}`] ?? [];
  return {
    created,
    updated,
    paginate: async (_method, { owner, repo }) =>
      list(owner, repo).map((m) => ({
        html_url: `https://github.com/${owner}/${repo}/milestone/${m.number}`,
        ...m,
      })),
    rest: {
      issues: {
        listMilestones: Symbol("listMilestones"),
        getMilestone: async ({ owner, repo, milestone_number }) => ({
          data: list(owner, repo).find((m) => m.number === milestone_number),
        }),
        createMilestone: async (request) => {
          if (failOn === request.title) {
            throw Object.assign(new Error("Forbidden"), { status: 403 });
          }
          created.push(request);
          const made = {
            number: next++,
            title: request.title,
            state: "open",
            description: request.description ?? "",
          };
          list(request.owner, request.repo).push(made);
          return {
            data: {
              ...made,
              html_url: `https://github.com/${request.owner}/${request.repo}/milestone/${made.number}`,
            },
          };
        },
        updateMilestone: async (request) => {
          updated.push(request);
          const found = list(request.owner, request.repo).find(
            (m) => m.number === request.milestone_number,
          );
          found.description = request.description;
        },
      },
    },
  };
}

const milestone = (number, title, description = "", state = "open") => ({
  number,
  title,
  description,
  state,
});

describe("withLink", () => {
  const url = "https://github.com/x/y/milestone/7";

  it("is the line if there is no description", () => {
    expect(withLink("", url)).toBe(linkLine(url));
    expect(withLink(null, url)).toBe(linkLine(url));
    expect(withLink("  \n", url)).toBe(linkLine(url));
  });

  it("adds the line after a description, and keeps it", () => {
    expect(withLink("Fixes of the 7.0 line", url)).toBe(
      `Fixes of the 7.0 line\n\n${linkLine(url)}`,
    );
  });

  it("changes nothing if the description has the URL already", () => {
    const text = `Notes\n\n${linkLine(url)}`;
    expect(withLink(text, url)).toBe(text);
  });
});

describe("openMilestones", () => {
  it("makes the milestones that are missing, with a title and nothing else", async () => {
    const octokit = fakeOctokit({ [oss]: [], [commercial]: [] });
    const results = await openMilestones(
      {
        creates: [
          { repository: oss, title: "7.0.10", exists: false },
          { repository: commercial, title: "7.0.10.1", exists: false },
        ],
      },
      { octokit },
    );
    expect(octokit.created).toEqual([
      { owner: "spring-projects", repo: "spring-security", title: "7.0.10" },
      {
        owner: "spring-projects",
        repo: "spring-security-commercial",
        title: "7.0.10.1",
      },
    ]);
    expect(results.map((r) => [r.title, r.result])).toEqual([
      ["7.0.10", "created"],
      ["7.0.10.1", "created"],
    ]);
  });

  it("gives the description that the plan has", async () => {
    const octokit = fakeOctokit({ [commercial]: [] });
    await openMilestones(
      {
        creates: [
          {
            repository: commercial,
            title: "7.0.0",
            description: "OSS milestone: https://x/y/milestone/3",
          },
        ],
      },
      { octokit },
    );
    expect(octokit.created[0].description).toBe(
      "OSS milestone: https://x/y/milestone/3",
    );
  });

  it("leaves a milestone that is there, open or closed", async () => {
    const octokit = fakeOctokit({
      [oss]: [milestone(1, "7.0.10", "", "closed")],
      [commercial]: [milestone(2, "7.0.10.1")],
    });
    const results = await openMilestones(
      {
        creates: [
          { repository: oss, title: "7.0.10" },
          { repository: commercial, title: "7.0.10.1" },
        ],
      },
      { octokit },
    );
    expect(octokit.created).toEqual([]);
    expect(results.map((r) => r.result)).toEqual(["exists", "exists"]);
  });

  it("adds the link to the OSS milestone that it made, and keeps the description", async () => {
    const octokit = fakeOctokit({
      [oss]: [],
      [commercial]: [
        milestone(5, "7.0.10", "Fixes shipped in 7.0.10", "closed"),
      ],
    });
    const results = await openMilestones(
      {
        creates: [{ repository: oss, title: "7.0.10" }],
        links: [
          {
            repository: commercial,
            title: "7.0.10",
            ossRepository: oss,
            ossTitle: "7.0.10",
          },
        ],
      },
      { octokit },
    );
    const url =
      "https://github.com/spring-projects/spring-security/milestone/100";
    expect(octokit.updated).toEqual([
      {
        owner: "spring-projects",
        repo: "spring-security-commercial",
        milestone_number: 5,
        description: `Fixes shipped in 7.0.10\n\n${linkLine(url)}`,
      },
    ]);
    expect(results.at(-1)).toMatchObject({ result: "linked", url });
  });

  it("does not link twice", async () => {
    const url =
      "https://github.com/spring-projects/spring-security/milestone/9";
    const octokit = fakeOctokit({
      [oss]: [milestone(9, "7.0.10")],
      [commercial]: [milestone(5, "7.0.10", linkLine(url), "closed")],
    });
    const results = await openMilestones(
      {
        links: [
          {
            repository: commercial,
            title: "7.0.10",
            ossRepository: oss,
            ossTitle: "7.0.10",
          },
        ],
      },
      { octokit },
    );
    expect(octokit.updated).toEqual([]);
    expect(results[0].result).toBe("linked-already");
  });

  it("gives nothing to a tracker that is not there, and says so", async () => {
    const octokit = fakeOctokit({
      [oss]: [milestone(9, "7.0.10")],
      [commercial]: [],
    });
    const results = await openMilestones(
      {
        links: [
          {
            repository: commercial,
            title: "7.0.10",
            ossRepository: oss,
            ossTitle: "7.0.10",
          },
        ],
      },
      { octokit },
    );
    expect(octokit.updated).toEqual([]);
    expect(results[0]).toMatchObject({ result: "skipped" });
    expect(results[0].reason).toContain("it is not there");
  });

  it("goes on after a milestone that fails, and says which", async () => {
    const octokit = fakeOctokit(
      { [oss]: [], [commercial]: [] },
      { failOn: "7.0.10" },
    );
    const results = await openMilestones(
      {
        creates: [
          { repository: oss, title: "7.0.10" },
          { repository: commercial, title: "7.0.10.1" },
        ],
      },
      { octokit },
    );
    expect(results.map((r) => r.result)).toEqual(["failed", "created"]);
    expect(results[0].error).toMatch(/403/);
  });
});
