/* FIRST, and it must stay first: `../boot` announces this launcher on `globalThis.__jxLauncher` and
   starts recording page errors as its module body evaluates. ESM evaluates imports in order, so
   only from this position does it run before the modules below — and it is one of THEM throwing at
   import (desktop 5.0.0-5.1.3, in the Electrobun shim) that it exists to record. See boot.ts. */
import { bootLauncher, stripLaunchToken } from "../boot";
import { hydrateGithubToken } from "@jxsuite/studio/github-auth";
import { createDesktopPlatform } from "./platform";

// CreateDesktopPlatform reads ?token from the shell URL to authenticate its WS upgrade.
await bootLauncher({ create: createDesktopPlatform, hydrateGithubToken, launcher: "chromium" });

/* Strip ?token from the address bar after boot so it never leaks (e.g. via a Referer header or a
   copy-pasted URL). The platform already captured it above — and it goes whether or not the boot
   succeeded: a failed boot leaves the window open on Studio's failure screen, and the token must
   not sit in that address bar either. */
stripLaunchToken();
