# run-gradle

A reusable composite action that sets up a JDK, optionally configures an artifact repository, and runs a Gradle command.

## Caller contract

- The workflow **must** run `actions/checkout` before using this action so the repository is present on the runner.
- The repository **must** contain a Gradle wrapper (`gradlew` and `gradle/wrapper`); this action does not install Gradle.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `gradle-args` | Yes | — | Gradle arguments. Passed as a single string and split on spaces (e.g. `"build test"` runs `./gradlew build test`). Arguments that contain spaces cannot be expressed with the current design. |
| `java-version` | No | `17` | The Java version to use. |
| `distribution` | No | — | The Java distribution to use (e.g. `temurin`). |
| `artifact-repository-url` | No | — | The artifact repository URL to use to resolve artifacts; uses the project's declared repos when not set. |
| `artifact-repository-username` | No | — | The artifact repository username; requires `artifact-repository-url` to be set. |
| `artifact-repository-password` | No | — | The artifact repository password; requires `artifact-repository-url` and `-username` to be set. |

## Artifact repository

When `artifact-repository-url` is set, the action installs an `init.gradle` that adds that Maven repository to all projects. For **authenticated** repos you must also set `artifact-repository-username` and `artifact-repository-password`. If you omit them, the repo is still added with empty credentials, which may work for public repos or fail for private ones.

## Example

```yaml
- uses: actions/checkout@v4

- name: Build and test
  uses: spring-io/spring-security-actions/run-gradle@v1
  with:
    gradle-args: "build test"

- name: Publish with custom repo
  uses: spring-io/spring-security-actions/run-gradle@v1
  with:
    gradle-args: "publishAllPublicationsToLocalRepository"
    artifact-repository-url: ${{ steps.repo.outputs.uri }}
    artifact-repository-username: ${{ secrets.REPO_USERNAME }}
    artifact-repository-password: ${{ secrets.REPO_PASSWORD }}
```
