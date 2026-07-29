# merge-release-branch

A reusable composite action that idempotently merges a just-published release tag back into its generation branch, then deletes the temporary release branch.

## Overview

Spring Security-style release trains cut a temporary `release/{tag}` branch to build and publish a version. Once the tag exists, its changes need to land back on the generation branch (e.g. `3.3.x`) so future work builds on top of the release, and the temporary branch is no longer needed. This action performs both steps and is safe to re-run if a prior run failed partway.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `tag` | Yes | — | The release tag that was just published (e.g. `3.3.9`). |

## Behavior

- **Target branch:** Computed from the tag as `{major.minor}.x` (e.g. `3.3.9` → `3.3.x`).
- **Merge:** Checks out the target branch and merges the tag into it with `git merge --no-ff -s ours`, so the generation branch's tree is unaffected while recording the tag as merged. If the tag is already an ancestor of the target branch, the merge is skipped.
- **Delete:** Deletes the `release/{tag}` branch from the remote, if it still exists.

## Example

```yaml
- uses: spring-io/spring-security-actions/merge-release-branch@v1
  with:
    tag: ${{ inputs.version || github.ref_name }}
```

## Related

- [publish-release-notes](https://github.com/spring-io/spring-security-actions/tree/main/publish-release-notes) — the companion action for generating and publishing the GitHub release, typically run after this action.
