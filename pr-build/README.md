# pr-build

A reusable composite action that sets up a JDK and builds a pull request. Unlike [build](https://github.com/spring-io/spring-security-actions/tree/main/build), it never publishes anything (no `publishAllPublicationsToLocalRepository`) and passes `-PskipCheckExpectedBranchVersion=true`, since a PR's branch name generally won't match the release-branch-version convention that check expects.

## Caller contract

- The workflow **must** run `actions/checkout` before using this action so the repository is present on the runner.
- The repository **must** contain a Gradle wrapper (`gradlew` and `gradle/wrapper`) and support the `-PskipCheckExpectedBranchVersion` project property (e.g. via `CheckExpectedBranchVersionPlugin`); if the project doesn't have that check, the property is simply ignored.
- Commercial-profile behavior and Develocity build-scan publishing are both controlled entirely by ambient environment variables set on the calling step, not by inputs to this action — see the example below. `gradle/actions/setup-gradle` (used internally) automatically detects a `DEVELOCITY_ACCESS_KEY` environment variable and exchanges it for a short-lived access token, so the long-lived key is never exposed to the build itself.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `java-version` | No | `17` | The Java version to use. |

## Example

```yaml
- uses: actions/checkout@v4

- name: Build Pull Request
  uses: spring-io/spring-security-actions/pr-build@v1
  env:
    COMMERCIAL_REPO_USERNAME: ${{ secrets.COMMERCIAL_ARTIFACTORY_USERNAME }}
    COMMERCIAL_REPO_PASSWORD: ${{ secrets.COMMERCIAL_ARTIFACTORY_PASSWORD }}
    DEVELOCITY_ACCESS_KEY: ${{ secrets.DEVELOCITY_ACCESS_KEY }}
```

## Related

- [build](https://github.com/spring-io/spring-security-actions/tree/main/build) — the equivalent action for the real (non-PR) build/deploy pipeline.
- [test](https://github.com/spring-io/spring-security-actions/tree/main/test) — tests against snapshot versions of upstream dependencies.
