# open-milestones

Makes the milestones of the next cycle of a code freeze, and adds the link to the OSS milestone to the commercial milestone that tracks it. The milestones are in the plan that `plan-freeze` wrote (`creates` and `links`). It runs after [close-milestones](../close-milestones/README.md).

A freeze from `7.0.9-SNAPSHOT` to `7.0.10-SNAPSHOT` makes OSS `7.0.10`, and the commercial `7.0.10.1` and `7.0.11` (the two that track the fixes of the new active branch), and adds `OSS milestone: <URL>` to the description of the commercial `7.0.10`. The rules are in [the code freeze guide](../docs/code-freeze.md#the-milestones-of-a-cycle).

## What it does

| What | When | Result |
|---|---|---|
| makes a milestone, with its title and nothing else (and the description, if the plan has one) | no milestone has that title in the repository, open or closed | `created` |
| leaves it alone | one has that title, open or closed | `exists` |
| adds `OSS milestone: <URL>` to the description of the commercial milestone, after the text that it has | it is there, and its description does not have that URL | `linked` |
| leaves it alone | the description has the URL already | `linked-already` |
| does nothing, and says why | the commercial milestone is not there, or the OSS one is not | `skipped` |
| any of the above, and GitHub refused | the others go on | `failed` |

A milestone is never changed except to add the line to a description. If any milestone failed, the action fails at the end and names each one: the freeze is done by then, so they are made or linked by hand.

A dry run does not run this action: the summary says what it would do from the plan.

## Inputs

| Input | Default | Description |
|---|---|---|
| `plan-file` | `code-freeze/plan.json` in `RUNNER_TEMP` | The plan, which has the milestones to make and to link. |
| `opened-file` | `code-freeze/milestones-opened.json` in `RUNNER_TEMP` | Where to write the result of each milestone. |
| `token` | required | A token that writes the milestones of both repositories. |

## Outputs

`opened-file`: for each milestone, `kind` (`create` or `link`), `repository`, `title`, `result`, and the `url`, the `reason` (a skip) or the `error` (a failure).

## Secrets and permissions

The token needs **Issues: Read and write** on the OSS and on the commercial repository (fine-grained), or `repo` (classic).

## Trying it

`npm ci`, then `npm test`: no network and no token.
