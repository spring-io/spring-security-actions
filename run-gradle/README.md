# run-gradle

A reusable composite action that runs a Gradle command, installing an `init.gradle` beforehand that makes the Spring commercial release repository available to every project.

## Caller contract

- The workflow **must** run `actions/checkout` before using this action so the repository is present on the runner.
- The workflow **must** set up a JDK before using this action; this action does not install a JDK.
- The repository **must** contain a Gradle wrapper (`gradlew` and `gradle/wrapper`); this action does not install Gradle.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `gradle-args` | Yes | — | Gradle arguments. Passed as a single string and split on spaces (e.g. `"build test"` runs `./gradlew build test`). Arguments that contain spaces cannot be expressed with the current design. |

## Artifact repository

The action always installs an `init.gradle` into `~/.gradle/init.d` that conditionally adds the `spring-commercial-release` Maven repository (`https://repo.spring.io/artifactory/spring-commercial-release-remote`) to every project. The repository is only added when the Gradle project properties `artifactoryUsername` and `artifactoryPassword` are both set — e.g. via the `ORG_GRADLE_PROJECT_artifactoryUsername`/`ORG_GRADLE_PROJECT_artifactoryPassword` environment variable convention. If neither is set, the init script is a no-op.

## Example

```yaml
- uses: actions/checkout@v4

- uses: actions/setup-java@v4
  with:
    java-version: "17"
    distribution: "temurin"

- name: Build and test
  uses: spring-io/spring-security-actions/run-gradle@v1
  with:
    gradle-args: "build test"

- name: Publish, resolving from the commercial repo
  uses: spring-io/spring-security-actions/run-gradle@v1
  with:
    gradle-args: "publishAllPublicationsToLocalRepository"
  env:
    ORG_GRADLE_PROJECT_artifactoryUsername: ${{ secrets.COMMERCIAL_ARTIFACTORY_USERNAME }}
    ORG_GRADLE_PROJECT_artifactoryPassword: ${{ secrets.COMMERCIAL_ARTIFACTORY_PASSWORD }}
```
