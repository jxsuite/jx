# Contributing to Jx

Fixes, features and improvements are all welcome, whether you write them yourself or hand the work to a coding agent. If you use an agent, point it at [`AGENTS.md`](AGENTS.md), which holds the conventions this repository enforces.

## A free month for merged code

Get a fix, feature or improvement merged into this repository and [Jx Studio Cloud](https://jxsuite.com/terms) is free for you for 30 days from the merge. Each new merge restarts the 30 days. If you already pay for the plan, you get a credit for a month's price on your next invoice instead, at most once in any 30 days.

Nothing to claim or fill in: it follows your GitHub account, and it is waiting if you sign in to the [hosted studio](https://studio.jxsuite.com) later.

- **It has to change code.** A pull request the test matrix does not run for gets the `no-credit` label automatically. That covers changes only to docs, specs, plans, the marketing site or CI configuration. Those contributions are still welcome.
- **It has to be yours.** The credit goes to the account that opened the pull request, and automated accounts earn nothing.
- **A maintainer can withhold it** by adding the `no-credit` label before merging.
- **Passing `ci` does not guarantee a merge.** Merging is a maintainer's decision, and it comes down to whether the change is wanted.

The [Terms of Service](https://jxsuite.com/terms) have the full conditions.

## Where to start

The specs in [`specs/`](specs) say what Jx should do, and where they admit something isn't built yet, a plan describes how to build it. [`plans/README.md`](plans/README.md) explains how plans work. To see them all, and which are closest to ready:

```bash
bun run plans:status
```

A plan is a complete brief, so it suits an agent well: point yours at one and tell it to follow `AGENTS.md` and `plans/README.md`. Most plans are still `drafted`, and a drafted plan can list `**Open:**` decisions. Open an issue to settle those before building, because a pull request that decides them on its own may not be merged.

You don't need a plan. Bug fixes and small improvements can go straight to a pull request, and a larger idea is worth an issue first.

## Making the change

[Working in the monorepo](https://jxsuite.com/docs/extending/contributing/monorepo) covers setup, commands and what CI runs. The short version:

```bash
bun install
bun run dev              # Studio in a browser
bun test --isolate       # from the package you changed
bun run lint
bun run typecheck
```

What every pull request needs:

- **Tests.** Every workspace enforces per-file coverage, and a new source file needs tests in the same pull request.
- **Specs and docs.** Update the spec before changing behavior, and keep the docs in step in the same pull request.
- **A conventional commit subject**, such as `fix(compiler): …` or `feat(studio): …`.
- **A green `ci` check.** It is required on `main`.

## Reporting problems

Report bugs in [GitHub issues](https://github.com/jxsuite/jx/issues). Report security problems privately, as the [security policy](.github/SECURITY.md) describes.
