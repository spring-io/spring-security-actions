# perform-release

A reusable composite action that idempotently performs Spring Security release announcement steps after artifacts have been deployed.

## Overview

This action runs the post-deployment release steps for Spring Security: generating release notes, creating the GitHub release, closing the milestone, updating the learn page on spring.io, optionally scheduling the next release milestone, and announcing the release in the Spring Team GChat room. It is intended to run only after artifacts have been successfully deployed (e.g. via the [deploy-artifacts](https://github.com/spring-io/spring-security-actions/tree/main/deploy-artifacts) action).

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `version` | Yes | — | The artifact version that was deployed. |
| `website-token` | Yes | — | GitHub token with permissions to update the spring.io website. |
| `gchat-webhook-url` | Yes | — | The GChat webhook URL used to announce the release in the Spring Team GChat room. |

## Behavior

- **Idempotent:** Steps are designed so the action can be re-run safely if a prior run failed partway.
- **Next snapshot:** Uses [spring-io/spring-release-actions/compute-next-snapshot](https://github.com/spring-io/spring-release-actions) to derive the next snapshot version from the released version.
- **Next milestone:** Uses [spring-io/spring-release-actions/compute-next-version](https://github.com/spring-io/spring-release-actions) to determine the next release milestone and date.
- **Release notes:** Generates notes via [spring-io/github-changelog-generator](https://github.com/spring-io/github-changelog-generator) using `etc/release-notes-sections.yml`, then publishes them with [spring-io/spring-release-actions/publish-release-notes](https://github.com/spring-io/spring-release-actions).
- **Milestone:** Closes the GitHub milestone for the released version and, for OSS releases only, schedules the next release milestone.
- **Learn page:** Updates the Spring Security learn page on spring.io (Antora-based) with the new version.
- **Announcement:** Sends the release announcement to the Spring Team GChat room via the provided webhook.

## Example

```yaml
- uses: spring-io/spring-security-actions/perform-release@v1
  with:
    version: ${{ steps.version.outputs.version }}
    website-token: ${{ secrets.SPRING_WEBSITE_TOKEN }}
    gchat-webhook-url: ${{ secrets.GCHAT_WEBHOOK_URL }}
```

## Related

- [deploy-artifacts](https://github.com/spring-io/spring-security-actions/tree/main/deploy-artifacts) — deploy artifacts before running this action.
- [spring-release-actions](https://github.com/spring-io/spring-release-actions) — shared release automation used by this action.
