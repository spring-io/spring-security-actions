# The milestones of a release, and its release train

A release of a project has milestones in two repositories, and a **release train** that it joins. This is how they are made, kept and closed, and the workflow that keeps them in step when someone edits one.

## The milestones of a cycle

The active embargoed branch (`embargoed/active/7.0.x`) is at the version of the release that the frozen branch builds now (`7.0.9-SNAPSHOT` builds `7.0.9`), so its fixes ship twice: as the hotfix `7.0.9.1`, and in the next release of OSS, `7.0.10`. The [CVE issues](cve-issues.md) are filed in both.

| Milestone | Repository | Made by | Closed by |
|---|---|---|---|
| `7.0.9` | OSS | the [code freeze](code-freeze.md) before it, or the release workflow, with a title only | the code freeze that releases it |
| `7.0.9` | commercial | the code freeze before it (it was the tracker of the next release), with the link to the OSS milestone, or the release workflow | closed by the code freeze before it |
| `7.0.9.1`, the hotfix | commercial | the code freeze before it, or the release workflow | the code freeze |
| `7.0.10`, the next release | commercial | the code freeze before it | the code freeze |

A freeze from `7.0.9-SNAPSHOT` to `7.0.10-SNAPSHOT` closes `7.0.9` (OSS), `7.0.9.1` and `7.0.10` (commercial), and makes OSS `7.0.10` and the commercial `7.0.10.1` and `7.0.11`. It does it from the version that the branches have after the bump, `7.0.10-SNAPSHOT`, with the step [ensure-milestones](../ensure-milestones/README.md): the version `7.0.9-SNAPSHOT` gives the same state one release earlier, so the same step checks a project that has not been frozen yet. [The code freeze guide](code-freeze.md#the-milestones-of-a-cycle) has the rules, and what a `.0` version does. The due dates and the release trains are not made by the freeze: they are set by people, and followed by the workflow below.

## The due date is the release train

The **due date of the OSS milestone** of a release is the date of its release train: `2026-11-19` is the train `2026.11.19`, the branch of that name in the release train repository. The release (`release/7.0.9`) joins it, and the hotfix (`release/7.0.9.1`) joins it too, **through the release workflow**, once it has built the branch against the train. A release that is not built is not joined: a hotfix has no branch when the active branch has nothing that the frozen one lacks, and that is not an error. The milestone of the hotfix is due on the **commercial general availability** of the train (`schedule.publication.commercial-general-availability`), and the commercial milestone `7.0.9` is due when the OSS one is.

The description of the milestones says which train they are in, once the train says that the release has joined, so that it can be seen, and left when the due date changes. A release that is not in a train has no line:

| The milestone | Its description |
|---|---|
| OSS `7.0.9` | `Release Train: 2026.11.19` as the first line, and any text after it |
| commercial `7.0.9` | the same first line as the OSS milestone (`Release Train: 2026.11.19`, or its `ERROR:` line), and `OSS milestone: <url>` after any text |
| commercial `7.0.9.1` | `Release Train: 2026.11.19` |
| commercial `5.8.30` (long-term support) | typed by a person, with the line `Release Train: 2026.11.19`, anywhere in it |

A long-term support version has no OSS milestone, so its line is what names its train, and its due date follows. The first line of the OSS milestone is the handler's: a line typed there is put back.

## What happens when a milestone is edited

[`sync-milestone.yml`](../.github/workflows/sync-milestone.yml) runs when a milestone is edited, in the OSS repository or in the commercial one, and the action [`sync-milestone`](../sync-milestone/README.md) does the rest:

| The edit | What it does |
|---|---|
| a due date is set on the OSS `7.0.9` | the commercial `7.0.9` gets the due date, the hotfix gets the commercial general availability. If the train exists and the release has not joined it, the release workflow is **started** on `embargoed/frozen/7.0.x`, and then on `embargoed/active/7.0.x` (the hotfix merges the new release), which builds the branches against the train and joins it, and writes the line |
| the due date of the OSS `7.0.9` changes | the release and the hotfix **leave** the train of the previous date (the workflow `Release Train - Leave`), and the same rebuild joins the new one |
| the due date is cleared | they leave the train, the lines are taken out, and the due dates of the commercial milestones are cleared. Nothing is rebuilt |
| the commercial milestone of an OSS version, or its hotfix, is edited | it is put back as the OSS milestone says |
| the line of a long-term support milestone changes | the release leaves the train that the old line named, the due date is set, and the release workflow is started on `embargoed/lts/5.8.x`, which joins the new one |

It never leaves a train that the release did not join, it never joins a train itself, and it writes nothing that is right already.

### When it cannot

Two errors are written into a description. Two things are **not** errors:

- **A due date whose train does not exist (yet)** is kept. The milestones have no train line, the release leaves the train it was in, and nothing is rebuilt until the train exists. The nightly run, or a run by hand with no milestone, finds the train later.
- **A release branch that does not exist.** Not building a branch means not joining it, on purpose: a hotfix with nothing to build has none. Nothing is written, and the release workflow ends with "Nothing to build", which is a success.

| The description | What happened | What to do |
|---|---|---|
| `ERROR: Cannot leave the Release Train 2026.11.19: it is ready` | The release is ready in the train that the due date moved it out of, and a ready train cannot be left. Nothing else was changed. | Sort it out in the release train, then edit the milestone again. |
| `ERROR: The Release Train 2026.11.19 has no commercial-general-availability` | The hotfix has no date to be due on. | Add `schedule.publication.commercial-general-availability` to the train. |

The release workflow ([release-branches](release-branches.md)) runs the same action after the release joins (`dispatch: false`, which assumes the release joined): it writes the `Release Train:` line.

## Setup

1. **The reusable workflow** is this repository's `sync-milestone.yml`. It runs in the commercial repository.
2. **The callers in the commercial repository**, on its **default branch** (`main`): GitHub runs the event `milestone` and the schedule only from there. `sync-milestone.yml` runs for an edit of a commercial milestone, every night, and by hand. `sync-milestone-oss.yml` runs for the OSS caller.
3. **The caller in the OSS repository**, on its default branch: it runs for an edit of an OSS milestone, and runs the caller of the commercial repository.
4. **The secret `RELEASE_AUTOMATION_TOKEN`** in both repositories (the one of the other workflows), and the permissions below. An edit by the user of the token is the handler's own, and is ignored, so that it does not run itself again. The owner of the token can still ask for a run: see [Setting a date as the owner of the token](#setting-a-date-as-the-owner-of-the-token).

### The callers of the commercial repository

Two files on the default branch, both calling the same reusable workflow (it has one concurrency group, so their runs queue one after the other). The first is for people and the clock, and its form has two inputs. The second is only for the caller of the OSS repository, so that its plumbing is not in that form.

`sync-milestone.yml`: the schedule, an edit of a commercial milestone, and a run by hand.

```yaml
name: sync-milestone
on:
  # every night: sync all the milestones, and build the release branches again
  schedule:
    - cron: "0 8 * * *"
  milestone:
    types: [edited]
  workflow_dispatch:
    inputs:
      milestone:
        description: "The title of the milestone, 7.0.9. Empty is all of them, and builds all the release branches again"
        required: false
      dry-run:
        description: "Only say what would be done"
        type: boolean
        default: true
permissions:
  contents: read
jobs:
  sync-milestone:
    uses: spring-io/spring-security-actions/.github/workflows/sync-milestone.yml@<tag>
    with:
      repository: ${{ github.repository }}
      milestone: ${{ inputs.milestone || github.event.milestone.title }}
      dry-run: ${{ github.event_name == 'workflow_dispatch' && inputs.dry-run }}
      changes: ${{ toJSON(github.event.changes) }}
      sender: ${{ (github.event_name == 'milestone' && github.event.sender.login) || '' }}
      release-train-repository: ${{ vars.RELEASE_TRAIN_REPOSITORY }}
      runs-on: ${{ vars.UBUNTU_RUNS_ON }}
    secrets:
      RELEASE_AUTOMATION_TOKEN: ${{ secrets.RELEASE_AUTOMATION_TOKEN }}
```

`sync-milestone-oss.yml`: run by the OSS dispatcher below, never by hand. An edit of an OSS milestone is always a real run.

```yaml
name: sync-milestone-oss
on:
  workflow_dispatch:
    inputs:
      repository:
        description: "The OSS repository of the milestone (the dispatcher gives it)"
        required: true
      milestone:
        description: "The title of the milestone that was edited (the dispatcher gives it)"
        required: true
      changes:
        description: "The changes of the event, as JSON (the dispatcher gives them)"
        required: true
      sender:
        description: "Who made the edit (the dispatcher gives it)"
        required: true
permissions:
  contents: read
jobs:
  sync-milestone:
    uses: spring-io/spring-security-actions/.github/workflows/sync-milestone.yml@<tag>
    with:
      repository: ${{ inputs.repository }}
      milestone: ${{ inputs.milestone }}
      changes: ${{ inputs.changes }}
      sender: ${{ inputs.sender }}
      release-train-repository: ${{ vars.RELEASE_TRAIN_REPOSITORY }}
      runs-on: ${{ vars.UBUNTU_RUNS_ON }}
    secrets:
      RELEASE_AUTOMATION_TOKEN: ${{ secrets.RELEASE_AUTOMATION_TOKEN }}
```

The schedule and an edit of a commercial milestone are real runs. Only a run by hand has a dry run, and it is on by default.

### Syncing by hand, with a dry run

Run `sync-milestone` of the commercial repository from the Actions tab (**Run workflow**, on its default branch):

| What you want | Inputs |
|---|---|
| see what would be done for every release of the project | `milestone` empty, `dry-run` on (the default) |
| do it | the same with `dry-run` off |
| one milestone, and what follows it | `milestone` `7.0.9` |

With no milestone the run starts with the step `ensure-milestones`, from the version of `gradle.properties` as the branches are now: it closes the milestones that are done, makes what is missing (a tracker that was never made), and says what is not as it should be. The summary of that step comes first. Then the trains are synced, and all the release branches are built again. A dry run writes nothing and runs nothing: the summary lists, for each milestone, what it would change (`would change spring-projects/spring-security 7.0.9: description is now: Release Train: 2026.11.19`), which releases would leave a train, and which branches it would build again, and ends with the totals. A real run does the same, and the totals say what was done.

All of them means the open milestones that have a release, in the OSS repository (each with its commercial milestone and its hotfix), and the open commercial milestones of long-term support (those with no OSS milestone, that have a `Release Train:` line or a long-term support branch). Closed milestones, the milestones that track the next release (`7.0.10`), titles that are not the version of a release (`7.0.x`), and an OSS milestone that has no due date and no `Release Train:` line (it has never been in a train, and its commercial milestone may be one that was released long ago) are left out. It knows no previous due date, so a release leaves the train that its description names. It writes the line of a release that the train says has joined.

A run for one milestone builds its releases again (`would be rebuilt (requested)` in a dry run), because the dependency updates of its train may have changed. An edit builds them again only when it changed the train (`(train changed)`): a typo in the description starts nothing.

It is how to bring the milestones of a project to what the handler would have made, after this was set up: run the dry run, read the summary, and run it again with `dry-run` off.

### The nightly run

The schedule of the caller runs all the milestones every night (08:00 UTC, which is 2 AM in US Central in winter and 3 AM in summer), on the default branch of the commercial repository. First it syncs all the milestones, which writes the train lines that the train now supports. Then it starts the release workflow on the embargoed branches, so that each release branch and snapshot branch is built again with the dependency updates that the train has now, a fresh build runs the tests, and the snapshot is published:

- `embargoed/frozen/<generation>` and `embargoed/lts/<generation>` first, all at once, and `embargoed/active/<generation>` after them. The hotfix merges the release, so it needs the new one.
- It rebuilds a release **until it is ready** in its train, and skips it after that. It also skips every branch while the code freeze runs, because the freeze marks releases ready and bumps the versions. A release with no train is built too, without dependency updates.
- A branch that has nothing to build (a hotfix, right after a freeze) is not an error: the run ends with "Nothing to build". Only a run that fails makes the nightly run fail, and it names the branch.
- Cost: about 20 runs of the release workflow a night for spring-security and spring-session together.

The same also starts when a due date, or the line of a long-term support milestone, changes: the handler leaves the old train, and builds the frozen branch, and then the active one, once.

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
          gh workflow run sync-milestone-oss.yml \
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
| run `release-train-leave.yml` on the release branches, the release workflow on the embargoed branches (and read its runs and the code freeze's), and the sync in the commercial repository from the OSS one | the commercial repository | **Actions: Read and write** | `repo` |
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
