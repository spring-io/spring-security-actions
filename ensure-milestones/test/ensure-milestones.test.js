import { describe, expect, it } from "vitest";
import {
  ensureMilestones,
  linkLine,
  render,
  repositoriesOf,
  versionsOf,
  withLink,
} from "../src/index.js";

const oss = "spring-projects/spring-security";
const host = "spring-projects/spring-security-commercial";
const repositories = { oss, host };

/**
 * The milestones that GitHub has: { repository: [{ number, title, state, description }] }, and
 * the branches of the commercial repository with their gradle.properties.
 */
function fakeOctokit(milestones, { failOn, versions = {} } = {}) {
  const created = [];
  const updated = [];
  let next = 100;
  const list = (owner, repo) => milestones[`${owner}/${repo}`] ?? [];
  const listBranches = Symbol("listBranches");
  return {
    created,
    updated,
    paginate: async (method, { owner, repo }) =>
      method === listBranches
        ? Object.keys(versions).map((name) => ({ name }))
        : structuredClone(list(owner, repo)).map((m) => ({
            html_url: `https://github.com/${owner}/${repo}/milestone/${m.number}`,
            open_issues: 0,
            ...m,
          })),
    rest: {
      issues: {
        listMilestones: Symbol("listMilestones"),
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
          Object.assign(found, {
            ...(request.state && { state: request.state }),
            ...(request.description !== undefined && {
              description: request.description,
            }),
          });
        },
      },
      repos: {
        listBranches,
        getContent: async ({ ref }) => {
          if (!(ref in versions)) {
            throw Object.assign(new Error("Not Found"), { status: 404 });
          }
          return {
            data: {
              content: Buffer.from(`version=${versions[ref]}\n`).toString(
                "base64",
              ),
            },
          };
        },
      },
    },
  };
}

let numbers = 0;
const milestone = (title, fields = {}) => ({
  number: ++numbers,
  title,
  state: "open",
  description: "",
  due_on: null,
  ...fields,
});

const urlOf = (repository, m) =>
  `https://github.com/${repository}/milestone/${m.number}`;

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

describe("repositoriesOf", () => {
  it("names the other repository from either", () => {
    const both = { oss, host };
    expect(repositoriesOf(oss)).toEqual(both);
    expect(repositoriesOf(host)).toEqual(both);
  });
});

describe("ensureMilestones, after a freeze from 7.0.9 to 7.0.10", () => {
  const state = () => {
    const ossOne = milestone("7.0.9");
    const tracker = milestone("7.0.10", {
      description: "Fixes shipped in 7.0.10",
    });
    return {
      ossOne,
      tracker,
      milestones: {
        [oss]: [milestone("7.0.8", { state: "closed" }), ossOne],
        [host]: [
          milestone("7.0.8.1", { state: "closed" }),
          milestone("7.0.9", { state: "closed" }),
          milestone("7.0.9.1"),
          tracker,
        ],
      },
    };
  };
  const versions = [
    { branch: "embargoed/frozen/7.0.x", version: "7.0.10-SNAPSHOT" },
  ];

  it("closes the milestones that are done, makes the ones of the next cycle, and links them", async () => {
    const { milestones } = state();
    const octokit = fakeOctokit(milestones);
    const { results } = await ensureMilestones(
      { repositories, versions, closing: ["7.0.9"] },
      { octokit },
    );
    const summary = results.map(
      (r) => `${r.action} ${r.repository.split("/")[1]} ${r.title} ${r.result}`,
    );
    expect(summary).toEqual([
      // OSS 7.0.9 was closed by the freeze before this step ("closing" says so for the dry run)
      "close spring-security 7.0.9 closed",
      "close spring-security-commercial 7.0.9.1 closed",
      "close spring-security-commercial 7.0.10 closed",
      "make spring-security 7.0.10 created",
      "make spring-security-commercial 7.0.10.1 created",
      "make spring-security-commercial 7.0.11 created",
      "link spring-security-commercial 7.0.10 linked",
    ]);
    expect(octokit.created.map((c) => c.title)).toEqual([
      "7.0.10",
      "7.0.10.1",
      "7.0.11",
    ]);
    // the link goes to the OSS milestone that was made, after the text that was there
    const madeOss = milestones[oss].find((m) => m.title === "7.0.10");
    expect(milestones[host].find((m) => m.title === "7.0.10").description).toBe(
      `Fixes shipped in 7.0.10\n\n${linkLine(urlOf(oss, madeOss))}`,
    );
    // nothing is deleted, and a milestone is closed whether or not it has issues
    expect(milestones[host].find((m) => m.title === "7.0.9.1").state).toBe(
      "closed",
    );
  });

  it("makes no edit a second time", async () => {
    const { milestones } = state();
    const octokit = fakeOctokit(milestones);
    await ensureMilestones({ repositories, versions }, { octokit });
    const edits = octokit.updated.length + octokit.created.length;
    const again = await ensureMilestones(
      { repositories, versions },
      { octokit },
    );
    expect(octokit.updated.length + octokit.created.length).toBe(edits);
    expect(again.results.map((r) => r.result)).toEqual([
      "already-closed",
      "already-closed",
      "already-closed",
      "exists",
      "exists",
      "exists",
      "linked-already",
    ]);
  });

  it("writes nothing in a dry run, and says what it would do", async () => {
    const { milestones } = state();
    const octokit = fakeOctokit(milestones);
    const { results } = await ensureMilestones(
      { repositories, versions, dryRun: true },
      { octokit },
    );
    expect(octokit.created).toEqual([]);
    expect(octokit.updated).toEqual([]);
    expect(results.filter((r) => r.result === "created")).toHaveLength(3);
    expect(results.filter((r) => r.result === "closed")).toHaveLength(3);
  });

  it("is the same from the state before the freeze, with the next release in place", async () => {
    // version 7.0.9: OSS 7.0.8 and the commercial 7.0.8.1 and 7.0.9 are done
    const milestones = {
      [oss]: [milestone("7.0.8", { state: "closed" }), milestone("7.0.9")],
      [host]: [
        milestone("7.0.8.1", { state: "closed" }),
        milestone("7.0.9"),
        milestone("7.0.9.1"),
        milestone("7.0.10"),
      ],
    };
    const octokit = fakeOctokit(milestones);
    const { results } = await ensureMilestones(
      { repositories, versions: [{ version: "7.0.9-SNAPSHOT" }] },
      { octokit },
    );
    // the one that is not as it should be: the commercial 7.0.9, which is open
    expect(
      results.filter((r) => r.result === "closed").map((r) => r.title),
    ).toEqual(["7.0.9"]);
    expect(octokit.created).toEqual([]);
  });

  it("does not reopen or delete anything, and says that a milestone is not there", async () => {
    const octokit = fakeOctokit({ [oss]: [], [host]: [] });
    const { results } = await ensureMilestones(
      { repositories, versions: [{ version: "7.0.2-SNAPSHOT" }] },
      { octokit },
    );
    expect(
      results.filter((r) => r.action === "close").map((r) => r.result),
    ).toEqual(["absent", "absent", "absent"]);
    expect(octokit.updated).toEqual([]);
  });

  it("goes on after a milestone that fails, and says which", async () => {
    const { milestones } = state();
    const octokit = fakeOctokit(milestones, { failOn: "7.0.10.1" });
    const { results } = await ensureMilestones(
      { repositories, versions },
      { octokit },
    );
    const failed = results.filter((r) => r.result === "failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ title: "7.0.10.1", action: "make" });
    expect(failed[0].error).toMatch(/403/);
    expect(results.find((r) => r.title === "7.0.11").result).toBe("created");
  });
});

describe("ensureMilestones, a .0 version before the GA", () => {
  it("closes the tracker of the next release candidate, and makes the one of the GA only if OSS has it", async () => {
    const withGa = {
      [oss]: [
        milestone("7.2.0-M1", {
          state: "closed",
          due_on: "2026-09-01T00:00:00Z",
        }),
        milestone("7.2.0-RC1", { due_on: "2026-10-01T00:00:00Z" }),
        milestone("7.2.0", { due_on: "2026-11-01T00:00:00Z" }),
      ],
      [host]: [milestone("7.2.0-RC1")],
    };
    const octokit = fakeOctokit(withGa);
    const { results } = await ensureMilestones(
      { repositories, versions: [{ version: "7.2.0-SNAPSHOT" }] },
      { octokit },
    );
    expect(results.map((r) => `${r.action} ${r.title} ${r.result}`)).toEqual([
      "close 7.2.0-RC1 closed",
      "make 7.2.0 created",
      "link 7.2.0-RC1 linked",
    ]);
    // made with the link to its OSS milestone from the start, and nothing in OSS
    expect(octokit.created).toHaveLength(1);
    expect(octokit.created[0].description).toMatch(
      /^OSS milestone: https:\/\//,
    );

    const withoutGa = {
      [oss]: [milestone("7.2.0-RC1", { due_on: "2026-10-01T00:00:00Z" })],
      [host]: [milestone("7.2.0-RC1")],
    };
    const warned = await ensureMilestones(
      { repositories, versions: [{ version: "7.2.0-SNAPSHOT" }] },
      { octokit: fakeOctokit(withoutGa) },
    );
    expect(warned.warnings).toEqual([
      expect.stringContaining("after 7.2.0-RC1"),
    ]);
  });
});

describe("versionsOf", () => {
  it("reads gradle.properties of the frozen and the long-term support branches, as they are", async () => {
    const octokit = fakeOctokit(
      {},
      {
        versions: {
          "embargoed/frozen/7.0.x": "7.0.10-SNAPSHOT",
          "embargoed/active/7.0.x": "7.0.10-SNAPSHOT",
          "embargoed/lts/5.8.x": "5.8.31-SNAPSHOT",
        },
      },
    );
    expect(await versionsOf(octokit, host)).toEqual([
      {
        branch: "embargoed/frozen/7.0.x",
        version: "7.0.10-SNAPSHOT",
        lts: false,
      },
      { branch: "embargoed/lts/5.8.x", version: "5.8.31-SNAPSHOT", lts: true },
    ]);
  });
});

describe("render", () => {
  it("says dry run, what each milestone would do, the warnings, and links the milestone", () => {
    const markdown = render({
      repository: oss,
      dryRun: true,
      warnings: ["no open milestone for 7.2.0 after 7.2.0-RC1"],
      results: [
        {
          action: "close",
          repository: host,
          title: "7.0.9",
          result: "closed",
          url: "https://x/9",
        },
        { action: "make", repository: oss, title: "7.0.10", result: "created" },
        {
          action: "link",
          repository: host,
          title: "7.0.10",
          result: "skipped",
          reason: "no milestone",
        },
        {
          action: "make",
          repository: host,
          title: "7.0.11",
          result: "failed",
          error: "403",
        },
      ],
    });
    expect(markdown).toContain(`# Milestones of ${oss}     DRY RUN`);
    expect(markdown).toContain("## Warnings");
    expect(markdown).toContain(
      `| [7.0.9](https://x/9) | ${host} | Close | Would be closed |`,
    );
    expect(markdown).toContain(`| 7.0.10 | ${oss} | Make | Would be made |`);
    expect(markdown).toContain("Skipped: no milestone");
    expect(markdown).toContain("Failed: 403");
  });

  it("says what was done for a real run", () => {
    const markdown = render({
      repository: oss,
      dryRun: false,
      results: [
        { action: "close", repository: host, title: "7.0.9", result: "closed" },
      ],
    });
    expect(markdown).not.toContain("DRY RUN");
    expect(markdown).toContain("| Closed |");
  });
});
