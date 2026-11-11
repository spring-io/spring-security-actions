import { stringify } from "yaml";

export const OSS = "spring-projects/spring-security";
export const HOST = "spring-projects/spring-security-commercial";
export const TRAINS = "spring-io/release-train";

/** A train.yml: the commercial general availability, and the releases that joined (and are ready). */
export function trainYaml({
  availability = "2026-12-24",
  joined = [],
  ready = [],
} = {}) {
  const releases = {};
  for (const version of joined) {
    releases[version] = {
      "commit-hashes": {
        joined: "a1",
        ...(ready.includes(version) && { ready: "b2" }),
      },
    };
  }
  return stringify({
    ...(availability && {
      schedule: {
        publication: {
          "commercial-general-availability": new Date(availability),
        },
      },
    }),
    releases: { "spring-security": releases },
  });
}

let numbers = 0;
export const milestone = (repository, title, fields = {}) => ({
  number: ++numbers,
  title,
  state: "open",
  due_on: null,
  description: "",
  html_url: `https://github.com/${repository}/milestone/${numbers}`,
  ...fields,
});

/**
 * An in-memory GitHub, with the parts of the API that the handler uses:
 *
 *   milestones  { repository: [milestone] }, changed by updateMilestone
 *   branches    { repository: [branch] } of the commercial repository (release/7.0.9)
 *   trains      { name: yaml } the branches of the release train repository
 *   user        the login of the token
 *
 * `updates` and `dispatches` record what was done.
 */
export function fakeGitHub({
  milestones = {},
  branches = [],
  trains = {},
  user = "release-bot",
} = {}) {
  const updates = [];
  const dispatches = [];
  const known = new Set([OSS, HOST, TRAINS]);
  const list = (owner, repo) => milestones[`${owner}/${repo}`] ?? [];
  const missing = () => Object.assign(new Error("Not Found"), { status: 404 });
  return {
    updates,
    dispatches,
    milestones,
    // as GitHub does: the milestones of the state asked for, and new objects every time
    paginate: async (_method, { owner, repo, state = "open" }) =>
      structuredClone(
        list(owner, repo).filter((m) => state === "all" || m.state === state),
      ),
    rest: {
      issues: {
        listMilestones: Symbol("listMilestones"),
        updateMilestone: async ({
          owner,
          repo,
          milestone_number,
          ...fields
        }) => {
          updates.push({
            repository: `${owner}/${repo}`,
            number: milestone_number,
            ...fields,
          });
          Object.assign(
            list(owner, repo).find((m) => m.number === milestone_number),
            fields,
          );
        },
      },
      repos: {
        get: async ({ owner, repo }) => {
          if (!known.has(`${owner}/${repo}`)) {
            throw missing();
          }
        },
        getBranch: async ({ owner, repo, branch }) => {
          const repository = `${owner}/${repo}`;
          const there =
            repository === TRAINS
              ? branch in trains
              : branches.includes(branch);
          if (!there) {
            throw missing();
          }
        },
        getContent: async ({ ref }) => ({
          data: {
            type: "file",
            content: Buffer.from(trains[ref]).toString("base64"),
          },
        }),
      },
      actions: {
        createWorkflowDispatch: async ({
          owner,
          repo,
          workflow_id,
          ref,
          inputs,
        }) => {
          dispatches.push({
            repository: `${owner}/${repo}`,
            workflow: workflow_id,
            ref,
            inputs,
          });
        },
      },
      users: { getAuthenticated: async () => ({ data: { login: user } }) },
    },
  };
}
