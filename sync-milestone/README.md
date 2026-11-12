# sync-milestone

Keeps the milestones of a release in step with its release train. It runs when a milestone is edited (the reusable workflow [`sync-milestone.yml`](../.github/workflows/sync-milestone.yml) calls it), and does what the guide, [docs/milestones.md](../docs/milestones.md), describes.

## What it decides

A release of OSS (`7.0.9`) has its milestone in the OSS repository, and its **due date is the date of its release train**: `2026-11-19` is the train `2026.11.19`. The release (`release/7.0.9`) joins that train, and so does its hotfix (`release/7.0.9.1`), whose milestone is in the commercial repository and is due on the **commercial general availability** of the train. The commercial milestone of the release itself (`7.0.9`) is due when the OSS one is, and has the link to it.

**It never joins a train.** The release workflow joins, once it has built the release branch against the train (the dependency updates), and a release that is not built is not joined: a hotfix with nothing to build has no branch, and that is not an error. What this action does when a date or a line changes is **leave** the train that the release was in, and start the release workflow on the embargoed branches (the frozen branch, and then the active one), which builds the branches again and joins the new train. The line `Release Train: <train>` is written when the train says that the release has joined.

| The milestone | The description | The due date |
|---|---|---|
| OSS `7.0.9` | `Release Train: 2026.11.19` as its first line, and any text after it | set by a person |
| commercial `7.0.9` | `Release Train: 2026.11.19` as its first line (the same as the OSS milestone's, errors too), and `OSS milestone: <url>` after any text | the one of the OSS milestone |
| commercial `7.0.9.1` (the hotfix) | `Release Train: 2026.11.19` | the commercial general availability of the train |
| commercial `5.8.30` (long-term support) | typed by a person, with the line `Release Train: 2026.11.19` | the commercial general availability of the train |

An edit of any of the first three, in either repository, makes all of them follow the OSS milestone: what was typed in the commercial milestone of an OSS version or in its hotfix is replaced. A long-term support version has no OSS milestone, and its line is the source. The commercial repository has a long-term support branch for it (`embargoed/lts/5.8.x`), which is how it is told from the milestone of a release that is not one.

- **The previous train.** A release that is in another train leaves it before the rebuild joins the new one. The previous train is the one of the previous due date (`changes.due_on.from` of the event), and the one that a description named. A train that the release did not join is not left.
- **A due date with no train** (no branch of that date in the release train repository yet) is kept. The milestones have no train line, the release leaves the train that it was in, and nothing is started. The hotfix keeps its due date, as it comes from the train. Once the train exists, the nightly run, or a run by hand with no milestone, finds it.
- **A train with no `schedule.publication.commercial-general-availability`** makes the hotfix say `ERROR: The Release Train 2026.11.19 has no commercial-general-availability`.
- **A train that is ready** cannot be left: the description is `ERROR: Cannot leave the Release Train 2026.11.19: it is ready`, and nothing else changes.
- **The due date is cleared:** the release leaves the train, and the line is taken out. Nothing is rebuilt.
- **The release workflow fails:** the run fails, and says on which branch. A branch that has nothing to build is not a failure.

Nothing is written to a milestone that is right already, so a run that is done again makes no edit. A milestone that is not the version of a release (`7.0.x`, `General Backlog`), a hotfix whose OSS milestone does not exist, and an edit of the title are left alone.

**Its own edits.** The handler writes the milestones with the token, and each edit is an event that would run it again. An edit made by the user of the token (`sender`, `github.event.sender.login`) is therefore left alone, and so is what the other automation does with the token (the code freeze closing a milestone, for one).

**The owner of the token can ask.** If the **description starts with `!`**, the edit is run once, and the handler takes the `!` out first: set the due date, and put `!` at the start of the description, in the same save (`!Release Train: 2026.11.19`, or `!Notes`). The edit that takes it out has no `!`, and is left alone, so it does not run again. A description that is just `!` is enough, when there is nothing else to say. Only the first character counts, and only for the user of the token: a `!` typed by anyone else is left where it is. A run by hand (`workflow_dispatch`) has no sender, and always runs.

## What GitHub sends

Measured on 2026-11-11 with a milestone of a throwaway repository, from the event `milestone` (`edited`):

| The edit | `changes` |
|---|---|
| a due date is set, and there was none | `{}` |
| the due date changes | `{"due_on": {"from": "2026-11-18T18:00:00.000-06:00"}}` |
| the due date is cleared | `{"due_on": {"from": "2026-12-16T18:00:00.000-06:00"}}` |
| the description is set, and was empty | `{}` |
| the description changes | `{"description": {"from": "!"}}` |

So a field that was empty is **not** in `changes`, and `{}` is treated as no changes: the milestone is synced as it is, with no previous train from the event (the description names it). The previous due date is **in the time zone of the one who edited**: `2026-11-18T18:00:00.000-06:00` is `2026-11-19T00:00:00Z`, the day of the train `2026.11.19`, and its first ten characters are the day before. It is read as an instant, and its UTC date is the day. The milestone itself has `due_on` as `2026-11-19T00:00:00Z`, and `null` for none.

## Inputs

| Input | Required | What it is |
|---|---|---|
| `repository` | yes | `owner/repo` of the milestone that was edited, OSS or commercial. |
| `milestone` | no | Its title, `7.0.9`. Empty syncs every open milestone of the project that has a release (the OSS ones, with their commercial milestone and hotfix, and the commercial ones of long-term support), and then builds all the release branches again. An OSS milestone with no due date and no `Release Train:` line is left out. A run for a milestone with no `changes` (by hand) builds its releases again. |
| `dry-run` | no, `false` | `true` writes nothing and runs nothing: the summary says what would be done, with the totals, and the outputs are the same. |
| `changes` | no | The field `changes` of the event, as JSON: `{"due_on":{"from":"2026-11-19T00:00:00Z"}}`. Empty for a run by hand. |
| `sender` | no | `github.event.sender.login`, for an edit. Empty for a run by hand. |
| `project` | no | The project id in the train, the name of the OSS repository by default. |
| `release-train-repository` | no | `spring-io/release-train` by default. |
| `dispatch` | no, `true` | `false` runs nothing (no leave, no rebuild, not even for all of them) and takes the releases as joined: it is for after the release joined, to write the lines. The release workflow does it. |
| `token` | yes | See below. |

## Outputs

`skipped`: `true` for an edit of the user of the token that does not start its description with `!`. `changed`: `true` if anything was done.

## Secrets and permissions

The token needs, on the **commercial** repository, **Issues: Read and write** (the milestones) and **Actions: Read and write** (to run `release-train-leave.yml` on the release branches, and the release workflow `release-branches.yml` on the embargoed branches, and to read its runs and those of the code freeze), on the **OSS** repository **Issues: Read and write**, and **Contents: Read-only** on the release train repository. A classic token with `repo` does all of it.

## Trying it

`npm ci`, then `npm test`: the tests use a fake of GitHub, and need no network and no token.
