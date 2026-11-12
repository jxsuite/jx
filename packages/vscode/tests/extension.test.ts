/**
 * What the extension starts when VS Code first opens a `.jxn` file, and that all of it is taken
 * away again when the extension stops.
 */
import { expect, mock, test } from "bun:test";

import { JXN_TRIGGER_CHARACTERS } from "@jxsuite/schema/jxn-completion";
import type { ExtensionContext } from "vscode";

import { fakeVscode } from "./_fake-vscode";

const fake = fakeVscode();
void mock.module("vscode", () => fake.module);

const { Position } = await import("vscode");
const { TYPESCRIPT_EXTENSION_ID } = await import("../src/content-mapper");
const { activate } = await import("../src/extension");

/** What `activate` reads of the context VS Code gives it. */
type Context = Pick<ExtensionContext, "extensionPath" | "subscriptions">;

/** Let what was started without being waited for run to its end. */
async function settled(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

test("starts completion and type checking, and logs what type checking could not do", async () => {
  // A TypeScript extension from before content mappers: it starts, and has nothing to register with.
  fake.install(TYPESCRIPT_EXTENSION_ID, () => Promise.resolve({}));
  const context: Context = { extensionPath: "/extensions/jx-vscode", subscriptions: [] };
  /* SAFETY: `activate` reads the two members above and nothing else of the context, which only the
     editor can build whole. */
  activate(context as ExtensionContext);
  await settled();

  const [provider] = fake.providers;
  expect(provider?.triggers).toEqual([...JXN_TRIGGER_CHARACTERS]);
  // Asked of a document that is not a file, it answers from the core without reading a project.
  const items = provider?.provide(
    {
      getText: () => "",
      offsetAt: () => 0,
      positionAt: () => new Position(0, 0),
      uri: { fsPath: "Untitled-1", scheme: "untitled" },
    },
    new Position(0, 0),
  );
  expect(items?.map((item) => item.label)).toContain("div");

  expect(fake.channels).toEqual([
    {
      disposed: false,
      log: true,
      name: "Jx Suite",
      warnings: [
        "The TypeScript extension has no content mappers: .jxn files are not type checked.",
      ],
    },
  ]);

  // The channel, the provider and the registration: each is the editor's to take away.
  expect(context.subscriptions).toHaveLength(3);
  for (const subscription of context.subscriptions) {
    subscription.dispose();
  }
  expect(fake.channels[0]?.disposed).toBe(true);
  expect(provider?.disposed).toBe(true);
  expect(fake.watchers()).toBe(0);
});
