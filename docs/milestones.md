# The milestones of a release, and its release train

A release of a project has milestones in two repositories, and a **release train** that it joins. This is how they are made, kept and closed, and the workflow that keeps them in step when someone edits one.

## The milestones of a cycle

The active embargoed branch (`embargoed/active/7.0.x`) is at the version of the release that the frozen branch builds now (`7.0.9-SNAPSHOT` builds `7.0.9`), so its fixes ship twice: as the hotfix `7.0.9.1`, and in the next release of OSS, `7.0.10`. The [CVE issues](cve-issues.md) are filed in both.

| Milestone | Repository | Made by | Closed by |
|---|---|---|---|
| `7.0.9` | OSS | the [code freeze](code-freeze.md) before it, or the release workflow, with a title only | the code freeze that releases it |
| `7.0.9` | commercial | the release workflow (a frozen branch), with the link to the OSS milestone | not closed by the freeze |
| `7.0.9.1`, the hotfix | commercial | the code freeze before it, or the release workflow | the code freeze, deleted if it has no issues |
| `7.0.10`, the next release | commercial | the code freeze before it | the code freeze, deleted if it has no issues |

A freeze from `7.0.9-SNAPSHOT` to `7.0.10-SNAPSHOT` closes `7.0.9` (OSS), `7.0.9.1` and `7.0.10` (commercial), and makes OSS `7.0.10` and the commercial `7.0.10.1` and `7.0.11`: [the code freeze guide](code-freeze.md#the-milestones-of-a-cycle) has the rules, and what a `.0` version does. The due dates and the release trains are not made by the freeze: they are set by people, and followed by the workflow below.

## The due date is the release train

The **due date of the OSS milestone** of a release is the date of its release train: `2026-11-19` is the train `2026.11.19`, the branch of that name in the release train repository. The release (`release/7.0.9`) joins it, and the hotfix (`release/7.0.9.1`) joins it too. The milestone of the hotfix is due on the **commercial general availability** of the train (`schedule.publication.commercial-general-availability`), and the commercial milestone `7.0.9` is due when the OSS one is.

The description of the milestones says which train they are in, so that it can be seen, and left when the due date changes:

| The milestone | Its description |
|---|---|
| OSS `7.0.9` | `Release Train: 2026.11.19` as the first line, and any text after it |
| commercial `7.0.9` | `OSS milestone: <url>`, after any text |
| commercial `7.0.9.1` | `Release Train: 2026.11.19` |
| commercial `5.8.30` (long-term support) | typed by a person, with the line `Release Train: 2026.11.19`, anywhere in it |

A long-term support version has no OSS milestone, so its line is what names its train, and its due date follows. The first line of the OSS milestone is the handler's: a line typed there is put back.

## What happens when a milestone is edited

[`sync-milestone.yml`](../.github/workflows/sync-milestone.yml) runs when a milestone is edited, in the OSS repository or in the commercial one, and the action [`sync-milestone`](../sync-milestone/README.md) does the rest:

| The edit | What it does |
|---|---|
| a due date is set on the OSS `7.0.9` | the release and the hotfix **join** the train of the date (the workflow `Release Train - Join` of the release branch); the commercial `7.0.9` gets the due date; the hotfix gets the commercial general availability, and the line |
| the due date of the OSS `7.0.9` changes | they **leave** the train of the previous date, and join the new one |
| the due date is cleared | they leave the train, the lines are taken out, and the due dates of the commercial milestones are cleared |
| the commercial milestone of an OSS version, or its hotfix, is edited | it is put back as the OSS milestone says |
| the line of a long-term support milestone changes | the release leaves the train that the old line named, and joins the new one, and the due date is set |

It never leaves a train that the release did not join, and it writes nothing that is right already.

### When it cannot

The description says why, and the milestone is not left looking right:

| The description | What happened | What to do |
|---|---|---|
| `ERROR: The Release Train 2026.12.31 doesn't exist` | There is no branch `2026.12.31` in the release train repository. The **due date was cleared** (or, for long-term support, the line was replaced), and the release left the train that it was in. | Set the due date again once the train has been created, or type another line. |
| `ERROR: Cannot join the Release Train 2026.11.19: release/7.0.9.1 does not exist` | The release branch is built when the embargoed branch is pushed, and it was not yet (or the active branch has nothing that the frozen one lacks, so there is no hotfix). | Push the embargoed branch. The release workflow joins the release, and writes the line. |
| `ERROR: Cannot leave the Release Train 2026.11.19: it is ready` | The release is ready in the train that the due date moved it out of, and a ready train cannot be left. Nothing else was changed. | Sort it out in the release train, then edit the milestone again. |
| `ERROR: The Release Train 2026.11.19 has no commercial-general-availability` | The hotfix has no date to be due on. | Add `schedule.publication.commercial-general-availability` to the train. |

The release workflow ([release-branches](release-branches.md)) runs the same action after the release joins (`dispatch: false`): it writes the `Release Train:` line, and replaces an `ERROR: Cannot join` line of an earlier run.

## Setup

1. **The reusable workflow** is this repository's `sync-milestone.yml`. It runs in the commercial repository.
2. **The caller in the commercial repository**, on its **default branch** (`main`): GitHub runs the event `milestone` only from there. It runs for an edit of a commercial milestone, and by hand.
3. **The caller in the OSS repository**, on its default branch: it runs for an edit of an OSS milestone, and runs the caller of the commercial repository.
4. **The secret `RELEASE_AUTOMATION_TOKEN`** in both repositories (the one of the other workflows), and the permissions below. An edit by the user of the token is the handler's own, and is ignored, so that it does not run itself again. The owner of the token can still ask for a run: see [Setting a date as the owner of the token](#setting-a-date-as-the-owner-of-the-token).

### The caller of the commercial repository

```yaml
name: sync-milestone
on:
  milestone:
    types: [edited]
  workflow_dispatch:
    inputs:
      repository:
        description: "The repository of the milestone (the OSS one, or this one)"
        required: false
      milestone:
        description: "The title of the milestone, 7.0.9"
        required: true
      changes:
        description: "The changes of the event, as JSON (the OSS caller gives them)"
        required: false
      sender:
        description: "Who made the edit (the OSS caller gives it)"
        required: false
permissions:
  contents: read
jobs:
  sync-milestone:
    uses: spring-io/spring-security-actions/.github/workflows/sync-milestone.yml@<tag>
    with:
      repository: ${{ inputs.repository || github.repository }}
      milestone: ${{ inputs.milestone || github.event.milestone.title }}
      changes: ${{ inputs.changes || toJSON(github.event.changes) }}
      sender: ${{ inputs.sender || (github.event_name == 'milestone' && github.event.sender.login) || '' }}
      release-train-repository: ${{ vars.RELEASE_TRAIN_REPOSITORY }}
      runs-on: ${{ vars.UBUNTU_RUNS_ON }}
    secrets:
      RELEASE_AUTOMATION_TOKEN: ${{ secrets.RELEASE_AUTOMATION_TOKEN }}
```

A run by hand with only `milestone` (and `repository` for an OSS milestone) syncs the milestones as they are: the train that the release has to leave is found from the description, as the previous due date is not known. It has no sender, so it always runs, whoever starts it.

### The caller of the OSS repository

The title of a milestone is typed by a person, so it is given to the script as an environment variable and not written into it.

```yaml
name: sync-milestone
on:
  milestone:
    types: [edited]
permissions: {}
jobs:
  dispatch:
    runs-on: ubuntu-latest
    steps:
      - name: Run the sync in the commercial repository
        env:
          GH_TOKEN: ${{ secrets.RELEASE_AUTOMATION_TOKEN }}
          TITLE: ${{ github.event.milestone.title }}
          CHANGES: ${{ toJSON(github.event.changes) }}
          SENDER: ${{ github.event.sender.login }}
        run: |
          gh workflow run sync-milestone.yml \
            --repo "${GITHUB_REPOSITORY}-commercial" --ref main \
            --field repository="$GITHUB_REPOSITORY" \
            --field milestone="$TITLE" \
            --field changes="$CHANGES" \
            --field sender="$SENDER"
```

### The token

`RELEASE_AUTOMATION_TOKEN` needs:

| What for | On | Fine-grained token | Classic token |
|---|---|---|---|
| read and write the milestones | both repositories | **Issues: Read and write** | `repo` |
| run `release-train-join.yml` and `release-train-leave.yml` on the release branches, and the sync in the commercial repository from the OSS one | the commercial repository | **Actions: Read and write** | `repo` |
| read the release train | the release train repository | **Contents: Read-only** | `repo` |

## Setting a date as the owner of the token

An edit by the user of the token is the handler's own, and is ignored. If you are that user (the token is yours), start the **description** of the milestone with **`!`**, in the same save as the due date: the handler runs for that edit, and takes the `!` out first. For the OSS milestone `7.0.9`:

```
Due date:     2026-11-19
Description:  !Release Train: 2026.11.19
              Notes of the release
```

becomes `Release Train: 2026.11.19` and the notes, once the release has joined. If there are no notes, the description is just `!`: that is enough, and it becomes `Release Train: 2026.11.19`. The edit that takes the `!` out is the handler's own, and is ignored, so it runs once. Only the first character of the description counts, and a `!` typed by another user is not taken out.

## Reading a run

The summary of the run lists what it did, one line each: the milestones written, the releases that joined or left, and why it did nothing (`neither the due date nor the description changed`, `is not the version of a release`). A run for an edit of the handler's own (the user of the token, without `!`) ends with `Skipped`.
