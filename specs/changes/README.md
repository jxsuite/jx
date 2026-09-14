# Spec release fragments

A file here is one spec release that has been recorded but not yet minted: `bun run spec:change <spec.md> <major|minor|patch|stable> -m "<what changed>"` writes it, naming the spec, the level and the changelog sentence, and touches nothing in the spec itself. Two fragments never conflict, which is the reason this form exists: releasing in place rewrites the spec's `**Version:**` line and the top of its `## Changelog`, and two pull requests releasing the same spec collide there.

`.github/workflows/release-specs.yml` runs `bun run spec:release` on the release pull request, which mints every fragment into its spec in the order each landed on `main` and deletes it, so this directory is empty at every release. The spec changelog page shows a fragment as **unreleased** until then. The format contract is in [`specs/README.md`](../README.md).
