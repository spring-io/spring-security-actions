# deploy-artifacts

A reusable composite action that deploys Spring Security artifacts to either Maven Central or Artifactory.

## Overview

This action encapsulates the artifact deployment steps from the [Deploy Artifacts workflow](https://github.com/spring-io/spring-security-release-tools/blob/main/.github/workflows/deploy-artifacts.yml) in spring-security-release-tools. Use it when you have already staged publications (e.g. via Gradle `publishAllPublicationsToLocalRepository`) and need to publish them to Central or Artifactory based on the target repository.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `version` | Yes | — | The artifact version to deploy. |
| `username` | Yes | — | The artifact repository username (Central token name or Artifactory username). |
| `password` | Yes | — | The artifact repository password (Central token or Artifactory password). |
| `repository-uri` | Yes | — | The artifact repository URI (e.g. from `compute-artifact-repository`). |
| `repository-name` | Yes | — | The artifact repository name (e.g. `central`, or Artifactory repo name from `compute-artifact-repository`). |
| `local-repository` | No | `build/publications/repos` | The location of the local repository to deploy. |

## Behavior

- **Branch name:** If the ref is `main`, the logical branch is derived as `{version major.minor}.x`; otherwise the ref name is used (e.g. for tags).
- **Central:** When `repository-name` is `central`, checksums are removed (to work around [central-publish-action#11](https://github.com/spring-io/central-publish-action/issues/11)), then [spring-io/central-publish-action](https://github.com/spring-io/central-publish-action) is used to publish.
- **Artifactory:** When `repository-name` is not `central`, [spring-io/artifactory-deploy-action](https://github.com/spring-io/artifactory-deploy-action) is used with the given URI, repository, and credentials.

## Example

```yaml
- uses: spring-io/spring-security-actions/deploy-artifacts@v1
  with:
    version: ${{ steps.version.outputs.version }}
    username: ${{ secrets.CENTRAL_TOKEN_USERNAME }}
    password: ${{ secrets.CENTRAL_TOKEN_PASSWORD }}
    repository-uri: ${{ steps.repo.outputs.uri }}
    repository-name: ${{ steps.repo.outputs.name }}
  # Or with explicit local repo:
  # local-repository: build/publications/repos
```

## Related

- [spring-security-release-tools deploy-artifacts workflow](https://github.com/spring-io/spring-security-release-tools/blob/main/.github/workflows/deploy-artifacts.yml) — workflow this action is patterned after.
