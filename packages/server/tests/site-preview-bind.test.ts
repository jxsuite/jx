/**
 * A preview server that fails to bind: the failure reaches the caller, and the project is not left
 * holding a dead entry, so the next `Open in Browser` tries again.
 */
import { afterAll, expect, mock, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface FakeServer {
  stop: () => Promise<void>;
  url: URL;
}

const binds: { reject: (error: Error) => void; resolve: (server: FakeServer) => void }[] = [];
void mock.module("#serve", () => ({
  serve: () =>
    new Promise((resolve, reject) => {
      binds.push({ reject, resolve });
    }),
}));

const { startSitePreview, stopSitePreviews } = await import("../src/site-preview.ts");

const ROOT = join(import.meta.dir, "_site_preview_bind_fixtures");
mkdirSync(join(ROOT, "dist"), { recursive: true });
writeFileSync(join(ROOT, "project.json"), JSON.stringify({ name: "s", version: "1.0.0" }));
writeFileSync(join(ROOT, "dist", "index.html"), "<html></html>");

afterAll(() => rmSync(ROOT, { force: true, recursive: true }));

test("a failed bind rejects, and the next start binds again", async () => {
  const first = startSitePreview(ROOT);
  await Promise.resolve();
  binds.at(-1)!.reject(new Error("EADDRINUSE"));
  // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
  await expect(first).rejects.toThrow("EADDRINUSE");
  const second = startSitePreview(ROOT);
  await Promise.resolve();
  expect(binds).toHaveLength(2);
  const stopped: boolean[] = [];
  binds.at(-1)!.resolve({
    stop: async () => {
      stopped.push(true);
    },
    url: new URL("http://127.0.0.1:4321/"),
  });
  expect(await second).toEqual({ origin: "http://127.0.0.1:4321", port: 4321 });
  await stopSitePreviews();
  expect(stopped).toEqual([true]);
});

test("stopping while a bind is in flight that then fails completes", async () => {
  const pending = startSitePreview(ROOT);
  await Promise.resolve();
  const stopping = stopSitePreviews();
  binds.at(-1)!.reject(new Error("EACCES"));
  // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
  await expect(pending).rejects.toThrow("EACCES");
  await stopping;
});
