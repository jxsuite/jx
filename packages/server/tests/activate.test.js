import { describe, test, expect, afterAll } from "bun:test";
import { createDevServer } from "../src/server.js";
import { join, resolve } from "node:path";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";

const FIXTURES = resolve(import.meta.dir, "_activate_fixtures");

// Create a fake project structure:
//   _activate_fixtures/
//     sites/demo/
//       project.json
//       public/
//         image.png
mkdirSync(join(FIXTURES, "sites/demo/public"), { recursive: true });
writeFileSync(join(FIXTURES, "sites/demo/project.json"), JSON.stringify({ name: "demo" }));
// Write a small valid PNG (1x1 transparent pixel)
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAB" +
    "Nl7pcQAAAABJRU5ErkJggg==",
  "base64",
);
writeFileSync(join(FIXTURES, "sites/demo/public/image.png"), PNG_1x1);

// Also create a file at repo root level to test baseline resolution
mkdirSync(join(FIXTURES, "root-public"), { recursive: true });
writeFileSync(join(FIXTURES, "root-public/root-file.txt"), "hello from root");

/** @type {any} */
let server;

describe("/__studio/activate + static file serving", () => {
  test("start server", async () => {
    server = await createDevServer({
      root: FIXTURES,
      port: 0,
      builds: [],
      watch: false,
      studio: true,
    });
    expect(server.port).toBeGreaterThan(0);
  });

  test("static file at repo root resolves normally", async () => {
    const res = await fetch(`http://localhost:${server.port}/root-public/root-file.txt`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello from root");
  });

  test("project-relative path 404s before activation", async () => {
    // /public/image.png doesn't exist at repo root, only under sites/demo/
    const res = await fetch(`http://localhost:${server.port}/public/image.png`);
    expect(res.status).toBe(404);
  });

  test("POST /__studio/activate sets active project root", async () => {
    const res = await fetch(`http://localhost:${server.port}/__studio/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ root: "sites/demo" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, root: "sites/demo" });
  });

  test("project-relative path resolves after activation", async () => {
    const res = await fetch(`http://localhost:${server.port}/public/image.png`);
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    // Verify it's a PNG (magic bytes)
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50); // 'P'
    expect(buf[2]).toBe(0x4e); // 'N'
    expect(buf[3]).toBe(0x47); // 'G'
  });

  test("repo-root files still resolve after activation", async () => {
    const res = await fetch(`http://localhost:${server.port}/root-public/root-file.txt`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello from root");
  });

  test("resolveSiteContext returns relPath for ?open= flow", async () => {
    const absPath = join(FIXTURES, "sites/demo/project.json");
    const res = await fetch(
      `http://localhost:${server.port}/__studio/resolve-site?path=${encodeURIComponent(absPath)}`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.relPath).toBe("sites/demo");
    expect(body.projectConfig).toEqual({ name: "demo" });
  });

  test("activation with different root switches resolution", async () => {
    // Deactivate / reset
    await fetch(`http://localhost:${server.port}/__studio/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ root: "" }),
    });
    // Should 404 again since no project root is active
    const res = await fetch(`http://localhost:${server.port}/public/image.png`);
    expect(res.status).toBe(404);
  });
});

afterAll(() => {
  if (server) server.stop();
  rmSync(FIXTURES, { recursive: true, force: true });
});
