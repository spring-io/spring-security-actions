# build

A reusable composite action that sets up a JDK and builds the project, publishing it to a local Maven repository (`build/publications/repos`) for a subsequent deploy step to pick up.

## Caller contract

- The workflow **must** run `actions/checkout` before using this action so the repository is present on the runner.
- The repository **must** contain a Gradle wrapper (`gradlew` and `gradle/wrapper`) and a `local` Maven publishing repository (e.g. via `PublishLocalPlugin`) so that `publishAllPublicationsToLocalRepository` resolves.
- Commercial-profile behavior (e.g. resolving dependencies from a commercial repository) is controlled entirely by ambient environment variables set on the calling step, not by inputs to this action — see the example below.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `java-version` | No | `17` | The Java version to use. |

## Example

```yaml
- uses: actions/checkout@v4

- name: Build
  uses: spring-io/spring-security-actions/build@v1
  env:
    COMMERCIAL_REPO_USERNAME: ${{ secrets.COMMERCIAL_ARTIFACTORY_USERNAME }}
    COMMERCIAL_REPO_PASSWORD: ${{ secrets.COMMERCIAL_ARTIFACTORY_PASSWORD }}
```

## Related

- [test](https://github.com/spring-io/spring-security-actions/tree/main/test) — the companion action for testing against upstream snapshot dependencies.
- [run-gradle](https://github.com/spring-io/spring-security-actions/tree/main/run-gradle) — a more general-purpose "run any Gradle command" action, for cases this action doesn't cover.
