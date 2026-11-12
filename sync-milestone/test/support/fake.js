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
 *   branches    [branch] of the commercial repository (release/7.0.9, embargoed/frozen/7.0.x)
 *   versions    { branch: "7.0.10-SNAPSHOT" }, the gradle.properties of those branches
 *   trains      { name: yaml } the branches of the release train repository
 *   user        the login of the token
 *   freezeRuns  the runs of the code freeze that are going on, "in_progress" or "queued"
 *   noWorkflow  branches that have no release workflow (404 when it is started)
 *   failing     branches where the run of the release workflow fails
 *
 * `updates`, `dispatches` and `runs` record what was done. A release workflow that is started
 * has ended by the time that its runs are listed.
 */
export function fakeGitHub({
  milestones = {},
  branches = [],
  trains = {},
  user = "release-bot",
  versions = {},
  freezeRuns = [],
  noWorkflow = [],
  failing = [],
} = {}) {
  const updates = [];
  const dispatches = [];
  const runs = [];
  const known = new Set([OSS, HOST, TRAINS]);
  const list = (owner, repo) => milestones[`${owner}/${repo}`] ?? [];
  const missing = () => Object.assign(new Error("Not Found"), { status: 404 });
  const listBranches = Symbol("listBranches");
  const allBranches = () => [
    ...new Set([...branches, ...Object.keys(versions)]),
  ];
  return {
    updates,
    dispatches,
    runs,
    milestones,
    // as GitHub does: the milestones of the state asked for, and new objects every time
    paginate: async (method, { owner, repo, state = "open" }) =>
      method === listBranches
        ? allBranches().map((name) => ({ name }))
        : structuredClone(
            list(owner, repo).filter(
              (m) => state === "all" || m.state === state,
            ),
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
        listBranches,
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
              : allBranches().includes(branch);
          if (!there) {
            throw missing();
          }
        },
        getContent: async ({ owner, repo, path, ref }) => {
          if (`${owner}/${repo}` === HOST && path === "gradle.properties") {
            if (!(ref in versions)) {
              throw missing();
            }
            return {
              data: {
                type: "file",
                content: Buffer.from(
                  `org.gradle.jvmargs=-Xmx2g\nversion=${versions[ref]}\n`,
                ).toString("base64"),
              },
            };
          }
          return {
            data: {
              type: "file",
              content: Buffer.from(trains[ref]).toString("base64"),
            },
          };
        },
      },
      actions: {
        createWorkflowDispatch: async ({
          owner,
          repo,
          workflow_id,
          ref,
          inputs,
        }) => {
          if (
            workflow_id === "release-branches.yml" &&
            noWorkflow.includes(ref)
          ) {
            throw missing();
          }
          dispatches.push({
            repository: `${owner}/${repo}`,
            workflow: workflow_id,
            ref,
            inputs,
          });
          if (workflow_id === "release-branches.yml") {
            runs.push({
              id: runs.length + 1,
              head_branch: ref,
              status: "completed",
              conclusion: failing.includes(ref) ? "failure" : "success",
              created_at: new Date().toISOString(),
              html_url: `https://github.com/${owner}/${repo}/actions/runs/${runs.length + 1}`,
            });
          }
        },
        listWorkflowRuns: async ({ workflow_id, branch, status }) => {
          if (workflow_id === "code-freeze.yml") {
            if (freezeRuns === null) {
              throw missing();
            }
            const going = freezeRuns.filter((r) => r === status);
            return { data: { total_count: going.length, workflow_runs: [] } };
          }
          const found = runs.filter((r) => r.head_branch === branch);
          return { data: { total_count: found.length, workflow_runs: found } };
        },
      },
      users: { getAuthenticated: async () => ({ data: { login: user } }) },
    },
  };
}
