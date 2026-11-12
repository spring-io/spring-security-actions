# ensure-milestones

Makes the milestones of a project what its **versions** say they should be, and closes the ones that are done. It is the milestone step of the [code freeze](../docs/code-freeze.md), and it is run by hand to check a project ([docs/milestones.md](../docs/milestones.md)). It reads `version=` of `gradle.properties` on the branches as they are: after a freeze has bumped them, the milestones follow.

## What it decides

The active embargoed branch is at the version of the release that the frozen branch builds now (`7.0.9-SNAPSHOT` builds `7.0.9`), so its fixes ship twice: in the hotfix of that release, and in the next release of OSS. Both are milestones of the **commercial** repository that **track** the fixes. From the version `7.0.10-SNAPSHOT` of a frozen branch (the one before it was `7.0.9`):

| What | Milestone | Repository |
|---|---|---|
| closed | `7.0.9` (the release before) | OSS |
| closed | `7.0.9.1` (the hotfix of the release before), `7.0.10` (the tracker of the release that ships next) | commercial |
| made, if missing | `7.0.10` | OSS |
| made, if missing | `7.0.10.1`, `7.0.11` (the trackers of the new active branch) | commercial |
| link added to the description | the commercial `7.0.10` gets `OSS milestone: <url of OSS 7.0.10>` | commercial |

It is the **same state before the freeze** (`7.0.9-SNAPSHOT`: `7.0.8` done, `7.0.9`, `7.0.9.1` and `7.0.10` there, the commercial `7.0.9` closed), so a run by hand finds a project that is right and leaves it alone, and finds what is not: a tracker that was never made, or a milestone that is still open.

- **The first patch after a GA** (`7.0.1-SNAPSHOT`): the release before is the GA, `7.0.0`, and its hotfix `7.0.0.1`.
- **A `.0` version before the GA** (`7.2.0-SNAPSHOT` with `7.2.0-RC1` and `7.2.0` open): the version does not change at a freeze, so the milestones decide. The release that is made next is the open one with the earliest due date. There is no hotfix and nothing to make in OSS (people plan the milestones and release candidates): the commercial tracker of that release is closed, and the tracker of the one after it is made, with its link, only if OSS has it. A warning says if no open milestone is left after it.
- **The GA as the release that is made next:** like any release, with no release before it to close.
- **Long-term support** (`5.8.31-SNAPSHOT`): the commercial `5.8.30` is closed. Nothing is made.

A milestone is **never deleted** and never reopened. One that is not there to be closed is said so (`Not there`), and one that is right is left alone, so a run that is done again does nothing.

## Inputs

| Input | Required | What it is |
|---|---|---|
| `repository` | yes | The project, the OSS repository or the commercial one (its name ends with `-commercial`). |
| `plan-file` | no | The plan of a code freeze. With it, the versions are the ones that the plan will bump the branches to, and the releases of the plan are taken as closed: the dry run of a freeze, before anything is bumped. Without it, the versions are read from the branches. |
| `output-file` | no | Where the result of each milestone is written, as JSON. `code-freeze/milestones-ensured.json` in `RUNNER_TEMP` by default. |
| `dry-run` | no, `false` | Write nothing: the summary says what would be done. |
| `token` | yes | See below. |

## Outputs

`ensured-file`: the file, `{ results, warnings }`. Each result has `action` (`close`, `make` or `link`), `repository`, `title`, `result` (`closed`, `already-closed`, `absent`, `created`, `exists`, `linked`, `linked-already`, `skipped` or `failed`) and the `url`, the `reason` of a skip or the `error` of a failure. If any failed, the action fails at the end, and says which: the freeze is done by then, so they are done by hand.

## Secrets and permissions

The token needs **Issues: Read and write** on the OSS and on the commercial repository, and **Contents: Read-only** on the commercial one (the versions). A classic token with `repo` does it.

## Trying it

`npm ci`, then `npm test`: the tests use a fake of GitHub, and need no network and no token. Against the real repositories, a dry run only reads:

```shell
env 'INPUT_REPOSITORY=spring-projects/spring-security' 'INPUT_DRY-RUN=true' \
    "INPUT_TOKEN=$(gh auth token)" GITHUB_STEP_SUMMARY=/dev/stdout GITHUB_OUTPUT=/dev/null \
    node dist/index.js
```
