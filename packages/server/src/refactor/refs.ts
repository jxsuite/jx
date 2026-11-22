/**
 * Refs.ts — the reference walk (`project-state.md` §12), published here as
 * `@jxsuite/server/refactor/refs` for the hosts that already import it from the server. Its one
 * definition lives in `@jxsuite/protocol/refs`, beside the contract, so a client that must not
 * depend on a backend (Studio, `studio.md` §3) walks with the same code.
 *
 * @docs studio/projects/pages-layouts-components
 */

export * from "@jxsuite/protocol/refs";
