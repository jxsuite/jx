/**
 * The Bun backend the Electron main process spawns: the window hub, wired to its IPC channel.
 *
 * Everything about a project lives here: sessions, loopback servers, git, the compiler, the AI
 * proxy. What lives in Electron is the pixels and the OS. The only inputs are the channel's
 * messages and the environment, and the only output is the channel, which is what lets a test drive
 * the whole backend with an array and a function.
 *
 * @docs studio/desktop
 */
import { isAbsolute, resolve } from "node:path";
import type { ImportApiOptions } from "@jxsuite/server/import-api";
import { appInfo } from "./app-info";
import { findChromium } from "./import-browser";
import type { BackendMessage, ShellMessage } from "./protocol";
import { createWindowHub } from "./window-hub";
import type { WindowHub } from "./window-hub";

/** The backend's whole outside world. */
export interface BackendIo {
  env: NodeJS.ProcessEnv;
  /** Where a Chromium-family browser is, for the site import; the PATH search by default. */
  findBrowser?: (env: NodeJS.ProcessEnv) => string | null;
  /** Subscribe to the shell's messages; a frame that is not one is dropped before it gets here. */
  onMessage: (listener: (message: ShellMessage) => void) => void;
  /** Speak to the shell. */
  send: (message: BackendMessage) => void;
}

/**
 * The site import's options.
 *
 * @param chromePath The browser puppeteer drives, or null when there is none: the app is whole
 *   without one, and the import is the one thing that says why it cannot run.
 */
export function importOptions(chromePath: string | null): ImportApiOptions {
  const options: ImportApiOptions = {
    resolveDest: (dir) => {
      // The webview resolves the destination under a natively picked parent before posting.
      if (!isAbsolute(dir)) {
        throw new Error("directory must be an absolute path");
      }
      return dir;
    },
  };
  if (chromePath) {
    options.chromePath = chromePath;
  }
  return options;
}

/**
 * Start the backend over `io`.
 *
 * @param io Its channel and environment.
 * @returns The hub, so a caller can stop it.
 */
export function startBackend(io: BackendIo): WindowHub {
  const studioDir = io.env.JX_STUDIO_ASSETS || resolve(import.meta.dirname, "../../assets/studio");
  /* The site import's headless browser: puppeteer cannot open a page in Electron, which answers
     `Target.createTarget` with "Not supported", so an installed Chromium or Chrome does it. */
  const importApi = importOptions((io.findBrowser ?? findChromium)(io.env));
  const hub = createWindowHub({ appInfo, importApi, send: io.send, studioDir });
  io.onMessage((message) => hub.handle(message));
  io.send({ type: "ready" });
  return hub;
}
