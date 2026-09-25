/* FIRST, and it must stay first: `./boot` announces this launcher on `globalThis.__jxLauncher` and
   starts recording page errors as its module body evaluates. ESM evaluates imports in order, so
   only from this position does it run before the modules below — and it is one of THEM throwing at
   import (desktop 5.0.0-5.1.3) that it exists to record. Anywhere later, that throw leaves no trace
   and Studio falls back to the dev-server adapter. See boot.ts. */
import { bootLauncher } from "./boot";
import { hydrateGithubToken } from "@jxsuite/studio/github-auth";
import { createDesktopPlatform } from "./platform";

await bootLauncher({ create: createDesktopPlatform, hydrateGithubToken, launcher: "electrobun" });
