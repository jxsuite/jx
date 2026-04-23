/**
 * Compile.js — Build step for Jx examples
 *
 * Compiles every example's JSON descriptor to a static HTML file in dist/. Each example is output
 * to dist/<example-name>/index.html. A Hono server handler is also emitted if the example has
 * server entries.
 *
 * Usage: bun run compile node compile.js
 */

import { compile, compileServer, compileElementPage } from "@jxsuite/compiler";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";

const __dir = import.meta.dir ?? dirname(new URL(import.meta.url).pathname);
const DIST_DIR = resolve(__dir, "dist");

/**
 * Each entry maps a human-readable name to its JSON descriptor and output path. Additional
 * compile() options can be supplied per-entry.
 */
const examples = [
  {
    name: "counter",
    src: resolve(__dir, "counter/counter.json"),
    out: resolve(__dir, "dist/counter/index.html"),
    title: "Counter — Jx",
  },
  {
    name: "todo",
    src: resolve(__dir, "todo/todo-app.json"),
    out: resolve(__dir, "dist/todo/index.html"),
    title: "Todo App — Jx",
  },
  {
    name: "form",
    src: resolve(__dir, "form/contact-form.json"),
    out: resolve(__dir, "dist/form/index.html"),
    title: "Contact Form — Jx",
  },
  {
    name: "list",
    src: resolve(__dir, "list/dynamic-list.json"),
    out: resolve(__dir, "dist/list/index.html"),
    title: "Dynamic List — Jx",
  },
  {
    name: "fetch",
    src: resolve(__dir, "fetch/fetch-demo.json"),
    out: resolve(__dir, "dist/fetch/index.html"),
    title: "Fetch Demo — Jx",
  },
  {
    name: "computed",
    src: resolve(__dir, "computed/user-card.json"),
    out: resolve(__dir, "dist/computed/index.html"),
    title: "Computed — Jx",
  },
  {
    name: "markdown",
    src: resolve(__dir, "markdown/blog.json"),
    out: resolve(__dir, "dist/markdown/index.html"),
    title: "Blog — Jx",
  },
  {
    name: "responsive",
    src: resolve(__dir, "responsive/responsive-card.json"),
    out: resolve(__dir, "dist/responsive/index.html"),
    title: "Responsive Card — Jx",
  },
  {
    name: "switch",
    src: resolve(__dir, "switch/router.json"),
    out: resolve(__dir, "dist/switch/index.html"),
    title: "Router — Jx",
  },
];

let ok = 0;
let fail = 0;

function _collectSrcModules(value, found = new Set()) {
  if (!value || typeof value !== "object") return found;

  if (typeof value.$src === "string") {
    found.add(value.$src);
  }

  if (Array.isArray(value)) {
    value.forEach((item) => _collectSrcModules(item, found));
    return found;
  }

  for (const child of Object.values(value)) {
    _collectSrcModules(child, found);
  }

  return found;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeModulePath(spec) {
  return spec
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
}

function rewriteClientModules(example, raw) {
  const doc = clone(raw);
  const copies = [];
  const outDir = dirname(example.out);
  const srcDir = dirname(example.src);

  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }

    if (typeof node.$src === "string" && node.$src.startsWith(".")) {
      const normalized = normalizeModulePath(node.$src);
      const rewritten = `./_modules/${normalized}`;
      copies.push({
        sourceFile: resolve(srcDir, node.$src),
        targetFile: resolve(outDir, "_modules", normalized),
      });
      node.$src = rewritten;
    }

    for (const child of Object.values(node)) walk(child);
  }

  walk(doc);
  return { doc, copies };
}

function copyClientModules(copies) {
  const uniqueCopies = new Map(copies.map((entry) => [entry.targetFile, entry]));
  for (const { targetFile, sourceFile } of uniqueCopies.values()) {
    mkdirSync(dirname(targetFile), { recursive: true });
    copyFileSync(sourceFile, targetFile);
    console.log(`   ${"".padEnd(12)}   ${relative(__dir, targetFile)}  (client module)`);
  }
}

rmSync(DIST_DIR, { recursive: true, force: true });

for (const ex of examples) {
  try {
    const raw = JSON.parse(readFileSync(ex.src, "utf8"));
    const { doc, copies } = rewriteClientModules(ex, raw);
    const [result, server] = await Promise.all([
      compile(doc, { title: ex.title }),
      compileServer(ex.src),
    ]);

    mkdirSync(dirname(ex.out), { recursive: true });
    writeFileSync(ex.out, result.html, "utf8");
    console.log(`✓  ${ex.name.padEnd(12)} → ${ex.out.replace(__dir + "/", "")}`);

    // Write companion JS module files (auto-generated custom elements)
    const outDir = dirname(ex.out);
    for (const f of result.files) {
      const filePath = resolve(outDir, f.path);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, f.content, "utf8");
      console.log(`   ${"".padEnd(12)}   ${relative(__dir, filePath)}  (${f.tagName})`);
    }

    copyClientModules(copies);

    if (server) {
      const serverOut = ex.out.replace(/(\.[^.]+)?$/, "-server.js");
      writeFileSync(serverOut, server, "utf8");
      console.log(`   ${"".padEnd(12)}   ${serverOut.replace(__dir + "/", "")}  (server handler)`);
    }

    ok++;
  } catch (err) {
    console.error(`✗  ${ex.name}: ${err.message}`);
    fail++;
  }
}

console.log(`\nCompiled ${ok} example(s)${fail ? `, ${fail} failed` : ""}.`);

// ─── Custom Element compilation ───────────────────────────────────────────────

const elementExamples = [
  {
    name: "custom-elements",
    src: resolve(__dir, "custom-elements/task-manager.json"),
    outDir: resolve(__dir, "dist/custom-elements"),
    title: "Task Manager — Compiled Output (No Jx Runtime)",
  },
];

let elOk = 0;
let elFail = 0;

for (const ex of elementExamples) {
  try {
    const { html, files } = await compileElementPage(ex.src, { title: ex.title });

    mkdirSync(ex.outDir, { recursive: true });

    // Write component JS files
    for (const file of files) {
      const relPath = relative(dirname(ex.src), file.path).replace(/\.json$/, ".js");
      const outPath = resolve(ex.outDir, relPath);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, file.content, "utf8");
      console.log(`   ${"".padEnd(12)}   ${relative(__dir, outPath)}  (${file.tagName})`);
    }

    // Write index.html
    const htmlPath = resolve(ex.outDir, "index.html");
    writeFileSync(htmlPath, html, "utf8");
    console.log(`✓  ${ex.name.padEnd(12)} → ${relative(__dir, htmlPath)}`);
    elOk++;
  } catch (err) {
    console.error(`✗  ${ex.name}: ${err.message}`);
    elFail++;
  }
}

if (elOk)
  console.log(`Compiled ${elOk} custom element example(s)${elFail ? `, ${elFail} failed` : ""}.`);
if (fail || elFail) process.exit(1);
