/** Rewrites `src/css-shorthands.ts` from `@webref/css`; see `css-shorthands-table.ts`. */

import { resolve } from "node:path";
import { buildShorthandTable, renderShorthandModule } from "./css-shorthands-table.ts";

const path = resolve(import.meta.dir, "../src/css-shorthands.ts");
await Bun.write(path, renderShorthandModule(await buildShorthandTable()));
Bun.spawnSync(["bunx", "oxfmt", path], { stderr: "inherit", stdout: "inherit" });
