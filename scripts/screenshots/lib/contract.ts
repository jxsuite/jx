/**
 * The two facts every reader of the screenshot manifest shares: where the committed manifest lives
 * and which contract version it is written against.
 *
 * They sit in a module of their own, holding nothing but constants, so a gate that needs only a
 * path or a version number (`check-shot-contract.ts`, `check-image-lock.ts`, `check-doc-sync.ts`)
 * does not load the manifest validator in `types.ts` along with it. Loading it would put that
 * module's predicates in the coverage report of every suite that runs those gates, at whatever
 * fraction the suite happens to exercise, when they are tested where they live.
 */

/**
 * The manifest shape the runner and `check-shot-contract.ts` both implement. A bump is for surface
 * SHAPE, never content drift.
 */
export const CONTRACT_VERSION = 1;

/** The committed manifest, repo-relative: every reader resolves it against the repo root or cwd. */
export const DEFAULT_MANIFEST = "scripts/screenshots/manifest.json";
