# run-gradle

A reusable composite action that runs a Gradle command, installing init scripts beforehand: an `init.gradle` that makes the Spring commercial release repository available to every project, and `usw1-mirrors.gradle` that redirects Maven Central and the Gradle Plugin Portal to the Artifactory mirrors.

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

## Artifactory mirrors

The action also installs `usw1-mirrors.gradle` into `~/.gradle/init.d`. It redirects the public repositories to the Spring Artifactory virtual repositories on `usw1.packages.broadcom.com`, for the project and for `buildSrc`:

- Maven Central (`repo.maven.apache.org`, `repo1.maven.org`) goes to `spring-maven-virtual`.
- The Gradle Plugin Portal (`plugins.gradle.org`) goes to `spring-plugins-gradle-virtual`.

It is active only when the environment variables `COMMERCIAL_REPO_USERNAME` and `COMMERCIAL_REPO_PASSWORD` are both set, and it does nothing otherwise, so a build without them is not affected. When it is active it logs a line, and with `--info` a line for each repository that it redirects. It never logs the credentials. The `releaseChannel` plays no part.

Every other repository (`repo.spring.io`, `shibboleth`, `Node.js`, ...) is left as the build declares it, and so are the repositories to publish to.

To use it on a machine, copy `usw1-mirrors.gradle` to `~/.gradle/init.d/` and export the credentials. `source ~/.commercial-artifactory.sh` sets `COMMERCIAL_ARTIFACTORY_USERNAME` and `COMMERCIAL_ARTIFACTORY_PASSWORD`, so also run `export COMMERCIAL_REPO_USERNAME=$COMMERCIAL_ARTIFACTORY_USERNAME COMMERCIAL_REPO_PASSWORD=$COMMERCIAL_ARTIFACTORY_PASSWORD`.

## Caller-supplied init scripts

If the repository being built has a `gradle/init.d` directory at its root, every `*.gradle` file in it is copied into `~/.gradle/init.d` alongside the action's own bundled `init.gradle`. This lets a caller add its own init scripts without duplicating the `mkdir`/`cp` logic this action already performs.

- The directory is optional; if it doesn't exist, nothing extra happens.
- A caller file literally named `init.gradle` overrides this action's bundled one, since the caller's directory is copied after it.

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
