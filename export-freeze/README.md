# export-freeze

Exports the branches that the code freeze changed, to look at in a dry run: a git repository with only those branches, which the workflow uploads as an artifact of the run (a zip that can be downloaded). A dry run makes the merges and the version commits in a clone of the runner and pushes nothing, so without this they are gone when the run ends. It is the same as [`export-merges`](../export-merges/README.md) for the merges of post-publish.

## What it does

- It makes a new repository in `directory` (it must not exist, or be empty) and fetches the branches that [`apply-freeze`](../apply-freeze/README.md) worked on, from the work refs of the clone (`refs/freeze/oss/*` and `refs/freeze/commercial/*`). Each is named as it is in its repository (`7.0.x`, `embargoed/active/main`), and the history of each is in it, so the commit before the freeze is too.
- The directory has a `README.md` with a table of the branches (repository, commit, the commit before the freeze or `up to date`, and the number of new commits), and the commands to look at them (`git log --graph --oneline`, `git log before..branch`, `git diff`). The summary of the step has the same table.
- **It is for looking only.** It has no remote and no command that pushes. The commercial branches have commits that must never go to OSS: the check of [`push-freeze`](../push-freeze/README.md) is what keeps them out, and nothing here bypasses it.
- No token: it reads the clone on the disk of the runner. Only whoever can read the commercial repository can download the artifact.
- The clone has `gc.auto` and `maintenance.auto` off, before the fetch: the lock files of git's background maintenance come and go while the directory is uploaded with `include-hidden-files: true`, and an upload that lists one that is gone fails.
- A branch name in the freeze of two repositories fails, as the export has one branch of each name.

## Inputs

| Input | Required | What it is |
|---|---|---|
| `plan-file` | no | The plan of `plan-freeze`, for the names of the repositories and the release train. `code-freeze/plan.json` in `RUNNER_TEMP` by default. |
| `apply-file` | no | What `apply-freeze` did. `code-freeze/apply.json` in `RUNNER_TEMP` by default. |
| `name` | no | The name of the export: its directory, and the artifact. `code-freeze-changes-<release train>` by default. |
| `directory` | no | Where to make it. The default is `name` in `RUNNER_TEMP`. |
| `dry-run` | no | `true` if the run is a dry run, which the summary and the README say. |
| `path` | no | The clone that `apply-freeze` worked in. `.` by default. |

## Outputs

`directory`, `name` and `count` (how many branches were exported: with 0 there is nothing to upload).

## Using it

```yaml
- id: export
  uses: spring-io/spring-security-actions/export-freeze@v1
  with:
    dry-run: true
- uses: actions/upload-artifact@v7
  with:
    name: ${{ steps.export.outputs.name }}
    path: ${{ steps.export.outputs.directory }}
    include-hidden-files: true
```

## Trying it

`npm ci`, then `npm test`: the tests make a clone with the work refs of a freeze by hand, and need no network.
