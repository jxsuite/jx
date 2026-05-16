import { resolve } from "node:path";
import { spawn } from "node:child_process";

const projectRoot = process.argv[2] || process.env.JSONSX_PROJECT_ROOT || process.cwd();

// Use the existing dev server from @jxsuite/server
const { createDevServer } = await import("@jxsuite/server");

const studioDir = resolve(import.meta.dir, "../assets/studio");

const server = await createDevServer({
  root: projectRoot,
  port: 0,
  watch: false,
  builds: [],

  middleware: async (req: Request, url: URL) => {
    const path = url.pathname;

    if (path.startsWith("/studio/")) {
      const assetPath = resolve(studioDir, "." + path.replace("/studio/", "/"));
      const file = Bun.file(assetPath);
      if (await file.exists()) {
        return new Response(file);
      }
    }

    // Serve project public files
    const publicFile = Bun.file(resolve(projectRoot, "public", "." + path));
    if (await publicFile.exists()) {
      return new Response(publicFile);
    }

    return null;
  },
});

const serverUrl = `http://localhost:${(server as { port: number }).port}`;
console.log(`[chromium-mode] Studio server at ${serverUrl}`);

// Find chromium/chrome binary
function findChromium(): string | null {
  const candidates = [
    process.env.CHROMIUM_BIN,
    "chromium",
    "chromium-browser",
    "google-chrome",
    "google-chrome-stable",
  ].filter(Boolean) as string[];

  for (const bin of candidates) {
    try {
      const result = Bun.spawnSync(["which", bin]);
      if (result.exitCode === 0) {
        return result.stdout.toString().trim();
      }
    } catch {}
  }
  return null;
}

const chromiumBin = findChromium();
if (!chromiumBin) {
  console.error("[chromium-mode] No chromium/chrome found. Install chromium or set CHROMIUM_BIN.");
  process.exit(1);
}

console.log(`[chromium-mode] Launching: ${chromiumBin}`);

const chromiumArgs = [
  `--app=${serverUrl}/studio/index.html`,
  "--no-first-run",
  "--no-default-browser-check",
  "--window-size=1400,900",
  `--user-data-dir=${resolve(projectRoot, ".jx/chromium-profile")}`,
];

if (process.env.WAYLAND_DISPLAY) {
  chromiumArgs.push("--ozone-platform=wayland", "--enable-features=UseOzonePlatform");
}

const chrome = spawn(chromiumBin, chromiumArgs, {
  stdio: "inherit",
  detached: false,
});

chrome.on("close", (code) => {
  console.log(`[chromium-mode] Browser closed (code ${code})`);
  process.exit(0);
});

process.on("SIGINT", () => {
  chrome.kill();
  process.exit(0);
});

process.on("SIGTERM", () => {
  chrome.kill();
  process.exit(0);
});
