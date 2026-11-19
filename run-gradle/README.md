# run-gradle

A reusable composite action that runs a Gradle command, installing init scripts beforehand: `commercial-repositories.gradle`, which adds the Spring commercial Maven repositories after the repositories that the build declares, and `usw1-mirrors.gradle`, which redirects Maven Central and the Gradle Plugin Portal to the Artifactory mirrors.

## Caller contract

- The workflow **must** run `actions/checkout` before using this action so the repository is present on the runner.
- The workflow **must** set up a JDK before using this action; this action does not install a JDK.
- The repository **must** contain a Gradle wrapper (`gradlew` and `gradle/wrapper`); this action does not install Gradle.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `gradle-args` | Yes | — | Gradle arguments. Passed as a single string and split on spaces (e.g. `"build test"` runs `./gradlew build test`). Arguments that contain spaces cannot be expressed with the current design. |

## Artifact repository

The action always installs `commercial-repositories.gradle` into `~/.gradle/init.d`. When credentials are set, it adds the Spring commercial Maven repositories **after** the repositories that the build declares. The build keeps its own order, with its own `mavenCentral()` first and only once, and the commercial repositories are asked only for what the ones before them do not have. The script does not add `mavenCentral()` itself.

The repositories, in two groups that are each added only with their own credentials:

- With the `REPO_SPRING_IO_USERNAME` and `REPO_SPRING_IO_PASSWORD` environment variables: `spring-commercial-release` (`https://repo.spring.io/artifactory/spring-commercial-release-remote`), and for a snapshot version `spring-commercial-snapshot-remote` (`https://repo.spring.io/artifactory/spring-commercial-snapshot-remote`). Both are skipped unless both variables are set.
- With the usw1 credentials below: `spring-enterprise-release` (`https://usw1.packages.broadcom.com/spring-enterprise-maven-prod-local`).
- With the usw1 credentials below, for a snapshot version: `spring-commercial-snapshot` (`https://usw1.packages.broadcom.com/spring-enterprise-maven-dev-local`).

The usw1 credentials come from the Gradle properties `artifactoryUsername`/`artifactoryPassword` (for example via the `ORG_GRADLE_PROJECT_artifactoryUsername`/`ORG_GRADLE_PROJECT_artifactoryPassword` environment variable convention), falling back to the `COMMERCIAL_REPO_USERNAME`/`COMMERCIAL_REPO_PASSWORD` environment variables. The two groups are independent: either one can be used without the other, and with neither nothing is added. Either way the script logs one line for each build (the root build, `buildSrc` and included builds), prefixed `commercial-repositories:`, and it never logs the credentials.

Where they are added, once the settings have been evaluated, so after the repositories that `settings.gradle` declares:

| Where | Rule |
|-------|------|
| Plugin repositories of the settings (`pluginManagement`) | Appended. If the build declares none, the Gradle Plugin Portal is added first, because it is the default only while there are none. |
| Repositories of the settings (`dependencyResolutionManagement`) | Appended. |
| Repositories of each project | Appended once the project has been evaluated, after the `afterEvaluate` callbacks of the build and of its plugins have run, only if the repositories mode of the settings is `PREFER_PROJECT` (the default) and the project has repositories by then, its own or a plugin's. A project that uses the repositories of the settings is left on them. Nothing is added to a project when the mode is `PREFER_SETTINGS` or `FAIL_ON_PROJECT_REPOS`. |

`buildSrc` and included builds get the same.

Not covered:

- The `buildscript` repositories of a project, which are used as soon as the `buildscript` block ends, and the `plugins {}` block of `settings.gradle`, which is resolved while `settings.gradle` is evaluated. `usw1-mirrors.gradle` redirects the plugin portal and Maven Central there.
- A configuration that is resolved while a project is configured, before it has been evaluated, does not see these repositories.
- A build that does not run through this action, for example one on a developer's machine, gets these repositories only if the script is applied and the credentials are set, see [Building with the commercial repositories locally](../docs/local-init-scripts.md).

## Artifactory mirrors

The action also installs `usw1-mirrors.gradle` into `~/.gradle/init.d`. It redirects the public repositories to the Spring Artifactory virtual repositories on `usw1.packages.broadcom.com`, for the project and for `buildSrc`:

- Maven Central (`repo.maven.apache.org`, `repo1.maven.org`) goes to `spring-maven-virtual`.
- The Gradle Plugin Portal (`plugins.gradle.org`) goes to `spring-plugins-gradle-virtual`.

It is active only when Artifactory credentials are set, and it does nothing otherwise, so a build without them is not affected. The credentials are the ones that `commercial-repositories.gradle` uses: the Gradle properties `artifactoryUsername` and `artifactoryPassword` (for example from the environment variables `ORG_GRADLE_PROJECT_artifactoryUsername` and `ORG_GRADLE_PROJECT_artifactoryPassword`, or `-P`), falling back to the environment variables `COMMERCIAL_REPO_USERNAME` and `COMMERCIAL_REPO_PASSWORD`. With only one of the two, it does nothing. When it is active it logs a line, and with `--info` a line for each repository that it redirects. It never logs the credentials. The `releaseChannel` plays no part.

Every other repository (`repo.spring.io`, `shibboleth`, `Node.js`, ...) is left as the build declares it, and so are the repositories to publish to.

To use them on a machine, see [Building with the commercial repositories locally](../docs/local-init-scripts.md).

## Caller-supplied init scripts

If the repository being built has a `gradle/init.d` directory at its root, every `*.gradle` file in it is copied into `~/.gradle/init.d` alongside the action's own bundled `commercial-repositories.gradle`. This lets a caller add its own init scripts without duplicating the `mkdir`/`cp` logic this action already performs.

- The directory is optional; if it doesn't exist, nothing extra happens.
- A caller file literally named `commercial-repositories.gradle` overrides this action's bundled one, since the caller's directory is copied after it.

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
