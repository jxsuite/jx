/**
 * The extension's manifest against the files and the code it names, because VS Code reads the
 * manifest alone and says nothing when it names something that is not there.
 */
import { expect, mock, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { JXN_LANGUAGE_ID } from "@jxsuite/schema/jxn";

import manifest from "../package.json";

import { fakeVscode } from "./_fake-vscode";
import { ROOT, SCOPE } from "./grammar";

void mock.module("vscode", () => fakeVscode().module);

const { CONTRIBUTOR_ID, mapperCommand } = await import("../src/content-mapper");

const [language] = manifest.contributes.languages;
const [grammar] = manifest.contributes.grammars;

test("contributes one language, the one the completion provider is registered for", () => {
  expect(manifest.contributes.languages).toHaveLength(1);
  expect(language?.id).toBe(JXN_LANGUAGE_ID);
  expect(language?.extensions).toEqual([".jxn"]);
  expect(manifest.activationEvents).toEqual([`onLanguage:${JXN_LANGUAGE_ID}`]);
  expect(Object.keys(manifest.contributes.configurationDefaults)).toEqual([`[${JXN_LANGUAGE_ID}]`]);
});

test("names a grammar and a language configuration that are in the package", () => {
  expect(existsSync(join(ROOT, language?.configuration ?? "absent"))).toBe(true);
  expect(grammar?.language).toBe(JXN_LANGUAGE_ID);
  expect(grammar?.scopeName).toBe(SCOPE);

  const source = readFileSync(join(ROOT, grammar?.path ?? "absent"), "utf8");
  expect(source).toContain(`"scopeName": "${SCOPE}"`);
  // The scope a block of code is given is what tells VS Code the language inside it.
  for (const scope of Object.keys(grammar?.embeddedLanguages ?? {})) {
    expect(source).toContain(`"contentName": "${scope}"`);
  }
  expect(grammar?.embeddedLanguages).toEqual({ "meta.embedded.block.typescript": "typescript" });
});

test("is built to the two files it starts, and packs those", () => {
  const packed = readFileSync(join(ROOT, ".vscodeignore"), "utf8").split("\n");
  const [, mapper = "absent"] = mapperCommand(ROOT, { env: {}, execPath: "node" });
  const built = [join(ROOT, manifest.main), mapper].map((file) => `dist/${basename(file)}`);
  expect(built).toEqual(["dist/extension.cjs", "dist/mapper.mjs"]);
  for (const file of built) {
    expect(manifest.scripts.build).toContain(`--outfile=${file} `);
    expect(packed).toContain(`!${file}`);
  }
  // Everything else is left out unless it is named, so no source and no test is published.
  expect(packed[0]).toBe("**");
});

test("is typed against the oldest VS Code it says it runs in", () => {
  expect(manifest.engines.vscode).toBe(`^${manifest.devDependencies["@types/vscode"]}`);
});

test("registers under the name VS Code knows it by", () => {
  expect(CONTRIBUTOR_ID).toBe(`${manifest.publisher}.${manifest.name}`);
});

test("bundles to one file that asks the editor for `vscode` and for nothing else", async () => {
  const built = await Bun.build({
    entrypoints: [join(ROOT, "src", "extension.ts")],
    external: ["vscode"],
    format: "cjs",
    target: "node",
  });
  expect(built.success).toBe(true);
  expect(built.outputs).toHaveLength(1);
  const text = (await built.outputs[0]?.text()) ?? "";
  const asked = [...text.matchAll(/\brequire\("([^"]+)"\)/gu)].map(([, name]) => name);
  expect([...new Set(asked)].toSorted()).toEqual(["node:fs", "node:path", "vscode"]);
});
