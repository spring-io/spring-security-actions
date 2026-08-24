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

The action always installs an `init.gradle` into `~/.gradle/init.d` that adds `mavenCentral()` and conditionally adds the Spring commercial Maven repositories to every subproject:

- `spring-commercial-release` (`https://usw1.packages.broadcom.com/spring-enterprise-maven-prod-local`) — added whenever credentials are present.
- `spring-commercial-snapshot` (`https://usw1.packages.broadcom.com/spring-enterprise-maven-dev-local`) — added additionally when the project version ends in `-SNAPSHOT`.

Credentials come from the Gradle project properties `artifactoryUsername`/`artifactoryPassword` — e.g. via the `ORG_GRADLE_PROJECT_artifactoryUsername`/`ORG_GRADLE_PROJECT_artifactoryPassword` environment variable convention — falling back to the `COMMERCIAL_REPO_USERNAME`/`COMMERCIAL_REPO_PASSWORD` environment variables. If neither username nor password is set, the commercial repositories are skipped.

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
