/**
 * The process TypeScript starts for `.jxn` files (`spec.md` §23.3): the mapper, answering over the
 * streams the compiler holds the other ends of.
 *
 * TypeScript finds it through this package's `typescript.contentMapper` manifest and starts it only
 * when run with `--runExternalCode`, because starting it is running a project's dependency.
 */
import { runContentMapper } from "ts-content-mapper";
import type { RunContentMapperOptions, RunningContentMapper } from "ts-content-mapper";

import { createMapper } from "./mapper.ts";

/**
 * Start answering.
 *
 * @param options The streams to answer over. Standard input and output, without any.
 */
export function run(options?: RunContentMapperOptions): RunningContentMapper {
  return runContentMapper(createMapper(), options);
}
