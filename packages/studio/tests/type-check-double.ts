/**
 * A double for `services/type-check.ts`, for the suites that mount the function editor under a fake
 * Monaco. The real service needs `createModel` and a TypeScript worker, neither of which a fake
 * editor has; what those suites assert is that the editor ASKS for a check at the right moments,
 * and that is what this records. `type-check.test.ts` covers the service itself.
 */
import { mock } from "bun:test";
import type { ProjectConfig } from "@jxsuite/schema/types";
import type { OutsideState } from "@jxsuite/schema/virtual-types";
import type { TypeCheckInit } from "../src/services/type-check";

/** Every check an editor has created, in order, with what it was created with. */
export const typeChecks: TypeCheckInit[] = [];

/** The code each `run` was asked to check. */
export const typeCheckRun = mock((_code: string) => Promise.resolve());

/** Calls to `dispose` on any check. */
export const typeCheckDispose = mock(() => {});

/** What the project was said to give: recognisable, so a test can tell it was passed on. */
export const GIVEN: OutsideState = { state: true };

/** Each path and configuration the editor asked about, when a check read what its project gives. */
export const outsideOfDocument = mock(
  (_path: string | null | undefined, _config: ProjectConfig | null | undefined) => GIVEN,
);

/** Forget what earlier tests recorded. */
export function resetTypeCheckDouble(): void {
  typeChecks.length = 0;
  outsideOfDocument.mockClear();
  typeCheckRun.mockClear();
  typeCheckDispose.mockClear();
}

/** Install the double. Call BEFORE importing `../src/panels/editors`. */
export function installTypeCheckDouble(): void {
  void mock.module("../src/services/type-check", () => ({
    createTypeCheck: (init: TypeCheckInit) => {
      typeChecks.push(init);
      return { dispose: typeCheckDispose, run: typeCheckRun };
    },
    outsideOfDocument,
  }));
}
