# Building with the commercial repositories locally

CI gets the Spring commercial Maven repositories and the Artifactory mirrors from the [run-gradle](../run-gradle/README.md) action. To build a commercial branch on your machine without it, apply the same two init scripts from a single `~/.gradle/init.gradle`:

- `commercial-repositories.gradle` adds the Spring commercial repositories after the repositories that the build declares.
- `usw1-mirrors.gradle` redirects Maven Central and the Gradle Plugin Portal to the Artifactory mirrors.

Both do nothing unless the credentials below are set.

## 1. Apply the scripts from `~/.gradle/init.gradle`

```groovy
// Latest from main (changes show up without any action on your side):
// def base = 'https://raw.githubusercontent.com/spring-io/spring-security-actions/main/run-gradle'

// Pinned to a release tag (reproducible, change the tag to update):
def base = 'https://raw.githubusercontent.com/spring-io/spring-security-actions/0.0.35/run-gradle'

apply from: "${base}/commercial-repositories.gradle"
apply from: "${base}/usw1-mirrors.gradle"
```

Comment out one `def base` line and keep the other. Remove any copies of the two scripts from `~/.gradle/init.d`, otherwise they are applied twice.

Gradle caches a script that it downloaded, so a build with `--offline` keeps working after the first fetch. Use `--refresh-dependencies` to fetch it again.

## 2. Set the credentials with environment variables

| Variable | What it is |
|---|---|
| `COMMERCIAL_REPO_USERNAME` | The Artifactory user for the Spring commercial repositories. |
| `COMMERCIAL_REPO_PASSWORD` | An Artifactory identity token. |

Generate the token on https://usw1.packages.broadcom.com/ui/user_profile while connected to the full VPN.

Use these environment variables. The Gradle properties `artifactoryUsername` and `artifactoryPassword`, and their environment variable equivalents `ORG_GRADLE_PROJECT_artifactoryUsername` and `ORG_GRADLE_PROJECT_artifactoryPassword`, are **deprecated**. The scripts still read them, and read them first, so if both are set the properties win. Remove them from your shell and files (for example from `~/.commercial-artifactory.sh`) so that the variables above are the only source.

### Keep them in a file and source it when you need them

Put the exports in their own file, for example `~/.env/commercial-artifactory-credentials.sh`, and make it readable by you only (`chmod 600`):

```bash
export COMMERCIAL_REPO_USERNAME=<your-username>
export COMMERCIAL_REPO_PASSWORD=<your-identity-token>
echo "Commercial repositories are active in this shell"
```

Run `source ~/.env/commercial-artifactory-credentials.sh` only in the shell where you want them. Do not source it from `.zshrc` or `.bashrc`.

Without the two variables the scripts add nothing, so a build of an OSS project cannot resolve from the commercial repositories by accident. Open a new shell, or `unset COMMERCIAL_REPO_USERNAME COMMERCIAL_REPO_PASSWORD`, to switch them off again.

## 3. Build

```bash
./gradlew build
```

Each build (the root build, `buildSrc` and included builds) logs one line prefixed `commercial-repositories:` that says whether the repositories were added. Add `--info` to see which repositories `usw1-mirrors.gradle` redirects. The credentials are never logged.
