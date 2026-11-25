/** Rewrites `src/css-shorthands.ts` from `@webref/css`; see `css-shorthands-table.ts`. */

import { buildShorthandTable, renderShorthandModule } from "./css-shorthands-table.ts";

const path = new URL("../src/css-shorthands.ts", import.meta.url).pathname;
await Bun.write(path, renderShorthandModule(await buildShorthandTable()));
Bun.spawnSync(["bunx", "oxfmt", path], { stderr: "inherit", stdout: "inherit" });
