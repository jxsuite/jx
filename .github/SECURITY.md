# Security policy

Jx Suite is maintained by Avunu LLC. This policy covers the code in this repository (the `@jxsuite/*` packages, the `jx` CLI and the Jx Studio desktop app), jxsuite.com, and the hosted studio at studio.jxsuite.com.

## Reporting a vulnerability

Email **[security@jxsuite.com](mailto:security@jxsuite.com)**. Please do not open a public issue, pull request or discussion for a suspected vulnerability.

Include what you can of:

- the affected package, app version or URL;
- the steps that reproduce it, or a proof of concept;
- what an attacker gains, as you understand it.

We acknowledge a report within three business days, keep you informed while we work on it, and agree a disclosure date with you once a fix ships. We credit reporters in the release notes unless you would rather we did not.

## Supported versions

Fixes land on `main` and ship in the next release of each affected package, and of the desktop app. Older releases are not patched: update to the latest release to receive a fix. The hosted studio is always the current version.

## Scope

In scope: anything that lets one user read or change another user's projects, sessions or credentials; code execution in the desktop app or the hosted studio from content an attacker controls; ways around the hosted studio's access checks; and supply-chain issues in what this repository publishes.

Out of scope: findings that need an already-compromised machine or account; denial of service by volume; missing hardening headers with no demonstrated impact; and vulnerabilities in a site someone built with Jx that come from that site's own code or configuration.
