/**
 * A stand-in for the slice of VS Code's API this extension calls, recording what was asked of it.
 *
 * The `vscode` module exists only inside the editor's extension host, so no test can load the real
 * one: a test hands `mock.module("vscode", …)` this fake's `module` before it imports the module
 * under test, and reads back from the record what that module registered.
 */
import type * as vscode from "vscode";

import { Position, Range } from "./_fake-vscode-values";

/** A document as the completion provider reads one. */
export interface FakeDocument extends Pick<
  vscode.TextDocument,
  "getText" | "offsetAt" | "positionAt"
> {
  uri: Pick<vscode.Uri, "fsPath" | "scheme">;
}

/** A completion provider as it was registered. */
export interface FakeProvider {
  /** Whether what registering it returned has been disposed. */
  disposed: boolean;
  language: string;
  provide: (document: FakeDocument, position: vscode.Position) => vscode.CompletionItem[];
  triggers: string[];
}

/** An installed extension, and how many times it was activated. */
export interface FakeExtension {
  activate: () => Promise<object | undefined>;
  activations: number;
}

/** A log channel and the warnings written to it. */
export interface FakeChannel {
  disposed: boolean;
  log: boolean;
  name: string;
  warnings: string[];
}

/** The fake API plus what it recorded. */
export interface FakeVscode {
  /** Fire `extensions.onDidChange`, as VS Code does when an extension is installed or enabled. */
  changed: () => void;
  channels: FakeChannel[];
  /**
   * Install an extension under an id, exporting what `exports` returns when it is activated, and
   * nothing when there is no `exports`.
   */
  install: (id: string, exports?: () => Promise<object>) => FakeExtension;
  /** What `mock.module("vscode", …)` is given. */
  module: object;
  providers: FakeProvider[];
  /** Forget everything recorded and installed, as a window just opened has. */
  reset: () => void;
  /** How many `extensions.onDidChange` listeners are still attached. */
  watchers: () => number;
}

/** VS Code's `CompletionItem`, which is its label and kind and whatever is set on it afterwards. */
class CompletionItem {
  readonly label: string;
  readonly kind: number;

  constructor(label: string, kind: number) {
    this.label = label;
    this.kind = kind;
  }
}

/** VS Code's `Disposable`. */
class Disposable {
  readonly #dispose: () => void;

  constructor(dispose: () => void) {
    this.#dispose = dispose;
  }

  dispose(): void {
    this.#dispose();
  }
}

/** VS Code's own numbers for the four kinds this extension draws. */
const CompletionItemKind = { Class: 6, Keyword: 13, Property: 9, Value: 11 };

/**
 * A fresh fake.
 *
 * @returns The module and its record.
 */
export function fakeVscode(): FakeVscode {
  const installed = new Map<string, FakeExtension>();
  const listeners = new Set<() => void>();
  const channels: FakeChannel[] = [];
  const providers: FakeProvider[] = [];

  return {
    changed: () => {
      for (const listener of listeners) {
        listener();
      }
    },
    channels,
    install: (id, exports) => {
      const extension: FakeExtension = {
        activate: async () => {
          extension.activations += 1;
          return await exports?.();
        },
        activations: 0,
      };
      installed.set(id, extension);
      return extension;
    },
    module: {
      CompletionItem,
      CompletionItemKind,
      Disposable,
      Position,
      Range,
      Uri: { file: (path: string) => ({ fsPath: path, scheme: "file" }) },
      extensions: {
        getExtension: (id: string) => installed.get(id),
        onDidChange: (listener: () => void) => {
          listeners.add(listener);
          return new Disposable(() => {
            listeners.delete(listener);
          });
        },
      },
      languages: {
        registerCompletionItemProvider: (
          language: string,
          provider: { provideCompletionItems: FakeProvider["provide"] },
          ...triggers: string[]
        ) => {
          const record: FakeProvider = {
            disposed: false,
            language,
            provide: (document, position) => provider.provideCompletionItems(document, position),
            triggers,
          };
          providers.push(record);
          return new Disposable(() => {
            record.disposed = true;
          });
        },
      },
      window: {
        createOutputChannel: (name: string, options: { log: boolean }) => {
          const channel: FakeChannel = { disposed: false, log: options.log, name, warnings: [] };
          channels.push(channel);
          return {
            dispose: () => {
              channel.disposed = true;
            },
            warn: (message: string) => {
              channel.warnings.push(message);
            },
          };
        },
      },
    },
    providers,
    reset: () => {
      installed.clear();
      listeners.clear();
      channels.length = 0;
      providers.length = 0;
    },
    watchers: () => listeners.size,
  };
}
