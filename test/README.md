# test

A reusable composite action that sets up a JDK and tests the project against snapshot versions of upstream dependencies (e.g. the next Spring Framework snapshot), to catch upstream breakage early.

## Caller contract

- The workflow **must** run `actions/checkout` before using this action so the repository is present on the runner.
- The repository **must** contain a Gradle wrapper (`gradlew` and `gradle/wrapper`) and support the `-PforceMavenRepositories=snapshot` project property (e.g. via `RepositoryConventionPlugin`) so dependencies resolve from the snapshot repository.
- The caller **must** provide `gradle-args` identifying which snapshot dependencies to test against — this action doesn't default to testing against anything, since those pins are project/branch-specific.
- Commercial-profile behavior is controlled entirely by ambient environment variables set on the calling step, not by inputs to this action — see the example below.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `java-version` | No | `17` | The Java version to use. |
| `gradle-args` | Yes | — | Gradle arguments identifying which snapshot dependencies to test against, e.g. `-PspringFrameworkVersion=7.+`. |

## Example

```yaml
- uses: actions/checkout@v4

- name: Test Against Snapshots
  uses: spring-io/spring-security-actions/test@v1
  with:
    gradle-args: "-PspringFrameworkVersion=7.+"
  env:
    COMMERCIAL_REPO_USERNAME: ${{ secrets.COMMERCIAL_ARTIFACTORY_USERNAME }}
    COMMERCIAL_REPO_PASSWORD: ${{ secrets.COMMERCIAL_ARTIFACTORY_PASSWORD }}
```

## Related

- [build](https://github.com/spring-io/spring-security-actions/tree/main/build) — the companion action for building and publishing the project.
- [run-gradle](https://github.com/spring-io/spring-security-actions/tree/main/run-gradle) — a more general-purpose "run any Gradle command" action, for cases this action doesn't cover.
