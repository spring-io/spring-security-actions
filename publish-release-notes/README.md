# publish-release-notes

A reusable composite action that generates a changelog for a release milestone and publishes it as a GitHub release.

## Overview

This action pairs [spring-io/github-changelog-generator](https://github.com/spring-io/github-changelog-generator) with [spring-io/spring-release-actions/publish-release-notes](https://github.com/spring-io/spring-release-actions) to turn a milestone's closed issues into release notes and publish them as the GitHub release for the given tag.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `tag` | Yes | — | The release tag/milestone to generate and publish notes for (e.g. `3.3.9`). |
| `config-file` | No | `scripts/release/release-notes-sections.yml` | Path to the `github-changelog-generator` config file, relative to the checked-out repository. |

## Behavior

- **Idempotent:** Re-running this action for the same tag regenerates and republishes the same release notes.
- **Changelog:** Uses the milestone matching `tag` and the given `config-file` to group closed issues into sections.
- **Publish:** Creates (or updates) the GitHub release for `tag` with the generated notes.

## Example

```yaml
- uses: spring-io/spring-security-actions/publish-release-notes@v1
  with:
    tag: ${{ inputs.version || github.ref_name }}
    config-file: scripts/release/release-notes-sections.yml
```

## Related

- [merge-release-branch](https://github.com/spring-io/spring-security-actions/tree/main/merge-release-branch) — typically run before this action, to fold the release tag back into its generation branch.
