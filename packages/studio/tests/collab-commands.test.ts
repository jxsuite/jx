/**
 * Tests for src/collab/collab-commands.ts — the `Collaborate:` family (collab.md §4).
 *
 * Co-editing has had no verb anywhere in the app: no way to start it, invite anyone, follow anyone
 * or stop. `CATEGORIES` has carried "Collaborate" since the registry landed, with nothing filed
 * under it. These pin the shape the registry checks — an idempotent setter with no bare toggle
 * beside it, a `requires` sentence on every record — and the two answers each verb can honestly
 * give.
 */
import { installMockPlatform, resetStudioState } from "./harness";
import { afterEach, describe, expect, test } from "bun:test";
import { closeAllTabs, openTab } from "../src/workspace/workspace";
import { resetCollabForTests } from "../src/collab/collab-session";
import { collabState } from "../src/collab/collab-state";
import { collabCommands, registerCollabCommands, sessionLink } from "../src/collab/collab-commands";
import { createCommandRegistry } from "../src/commands/registry";
import { emptyContext } from "../src/commands/context";
import { problems, resetNotifications, toasts } from "../src/services/notify";

import type { AnyCommand, Command } from "../src/commands/registry";
import type { CommandArgValues } from "../src/commands/command-args";
import type { PeerPresence } from "../src/collab/collab-state";
import { EMPTY_DOC } from "./shared-fixtures";

const PATH = "pages/shared.json";

function byId(id: string): AnyCommand {
  const found = collabCommands().find((c) => c.id === id);
  if (!found) {
    throw new Error(`no command "${id}"`);
  }
  return found;
}

/**
 * Run a record's `run` directly, past its `when` and `enablement` predicates, the way the
 * registry's API path can reach it. The verbs here guard again inside `run`, and that guard is what
 * is tested.
 */
function runDirect(command: AnyCommand, args: CommandArgValues = {}): void | Promise<void> {
  /* SAFETY: AnyCommand is Command<never> only so one array can hold every record. The two collab
     Records that declare `args` (collab.setEnabled, collab.follow) read them only through
     `booleanArg` / `optionalStringArg`, which take a CommandArgValues record, and the other three
     Never read their argument at all. */
  const typed = command as Command<CommandArgValues>;
  return typed.run(emptyContext(), args);
}

function openShared() {
  installMockPlatform();
  resetStudioState();
  return openTab({ document: structuredClone(EMPTY_DOC), documentPath: PATH, id: PATH });
}

/** Every message the family posted, whichever tier it landed in. */
function messages(): string[] {
  return [...toasts, ...problems].map((n) => n.message);
}

afterEach(() => {
  closeAllTabs();
  resetCollabForTests();
  resetNotifications();
});

describe("the family", () => {
  test("every record declares its category, level and a requires sentence", () => {
    for (const command of collabCommands()) {
      expect(command.category).toBe("Collaborate");
      expect(command.level).toBe("document");
      expect(command.requires).toBeTruthy();
      expect(command.title.startsWith("Collaborate: ")).toBe(true);
    }
  });

  test("registerCollabCommands puts every record into a registry under one category", () => {
    const registry = createCommandRegistry({ getContext: emptyContext });
    registerCollabCommands(registry);
    const registered = registry.list().filter((c) => c.category === "Collaborate");
    expect(registered.map((c) => c.id).toSorted()).toEqual(
      collabCommands()
        .map((c) => c.id)
        .toSorted(),
    );
  });

  test("there is no toggle — the join/leave verb is an idempotent setter", () => {
    const ids = collabCommands().map((c) => c.id);
    expect(ids.filter((id) => /\.toggle[A-Z]/.test(id))).toEqual([]);
    expect(ids).toContain("collab.setEnabled");
  });
});

describe("collab.setEnabled", () => {
  test("leaving, then leaving again, says it once — the second call is a no-op", async () => {
    const tab = openShared();
    void tab;
    await runDirect(byId("collab.setEnabled"), { enabled: false });
    expect(messages()).toEqual(["Left the collaboration session for this document."]);
    await runDirect(byId("collab.setEnabled"), { enabled: false });
    expect(messages()).toHaveLength(1);
  });

  test("re-joining after leaving is the same setter with the other value", async () => {
    openShared();
    await runDirect(byId("collab.setEnabled"), { enabled: false });
    await runDirect(byId("collab.setEnabled"), { enabled: true });
    expect(messages().at(-1)).toContain("Connecting");
  });

  test("it is hidden without an open document", () => {
    closeAllTabs();
    expect(byId("collab.setEnabled").when?.(emptyContext())).toBe(false);
  });
});

describe("collab.stop", () => {
  test("it is disabled until a session is actually live", () => {
    const tab = openShared();
    expect(byId("collab.stop").enablement?.(emptyContext())).toBe(false);
    collabState(tab).active = true;
    expect(byId("collab.stop").enablement?.(emptyContext())).toBe(true);
  });

  test("stopping leaves, and stopping twice says nothing the second time", async () => {
    const tab = openShared();
    collabState(tab).active = true;
    await runDirect(byId("collab.stop"));
    expect(messages()).toEqual(["Left the collaboration session for this document."]);
    await runDirect(byId("collab.stop"));
    expect(messages()).toHaveLength(1);
  });
});

describe("collab.copyLink", () => {
  test("the link is derived from the document path — it names a room, it grants nothing", () => {
    const tab = openShared();
    expect(sessionLink(tab)).toBe("jx://collab/pages/shared.json");
  });

  test("a copied link is confirmed, with the limit of what it grants stated", async () => {
    const tab = openShared();
    collabState(tab).active = true;
    const original = globalThis.navigator.clipboard;
    const written: string[] = [];
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          written.push(text);
        },
      },
    });
    try {
      await runDirect(byId("collab.copyLink"));
    } finally {
      Object.defineProperty(globalThis.navigator, "clipboard", {
        configurable: true,
        value: original,
      });
    }
    expect(written).toEqual(["jx://collab/pages/shared.json"]);
    expect(messages().at(-1)).toContain("does not grant access");
  });

  test("a clipboard refusal is reported with the link, not swallowed", async () => {
    const tab = openShared();
    collabState(tab).active = true;
    const original = globalThis.navigator.clipboard;
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
    });
    try {
      await runDirect(byId("collab.copyLink"));
    } finally {
      Object.defineProperty(globalThis.navigator, "clipboard", {
        configurable: true,
        value: original,
      });
    }
    const failure = [...problems, ...toasts].find((n) => n.message.includes("Could not copy"));
    expect(failure?.detail).toBe("jx://collab/pages/shared.json");
  });
});

describe("collab.follow", () => {
  const peer = (login: string, focusedPath: string | null): PeerPresence => ({
    clientId: 1,
    state: {
      focusedPath,
      structuralSelection: null,
      user: { color: "#123456", login },
    },
  });

  test("it is disabled while nobody else is here", () => {
    openShared();
    expect(byId("collab.follow").enablement?.(emptyContext())).toBe(false);
  });

  test("following a peer offers the file they are in as the recovery command", async () => {
    const tab = openShared();
    collabState(tab).peers = [peer("ada", "layouts/base.json")];
    await runDirect(byId("collab.follow"), { login: "ada" });
    const note = [...toasts].at(-1)!;
    expect(note.message).toContain("layouts/base.json");
    expect(note.action).toBe("file.open");
    expect(note.actionArgs).toEqual({ path: "layouts/base.json" });
  });

  test("naming somebody who is not here is refused by name", async () => {
    const tab = openShared();
    collabState(tab).peers = [peer("ada", "a.json")];
    await runDirect(byId("collab.follow"), { login: "bob" });
    expect(messages().at(-1)).toBe("bob is not in this session.");
  });

  test("a peer between documents is reported as such, not as an absence", async () => {
    const tab = openShared();
    collabState(tab).peers = [peer("ada", null)];
    await runDirect(byId("collab.follow"), {});
    expect(messages().at(-1)).toBe("ada is not in a document right now.");
  });
});

describe("collab.showStatus", () => {
  test("it states all four things that used to be invisible, including the undo rule", async () => {
    const tab = openShared();
    Object.assign(collabState(tab), {
      active: true,
      readOnly: true,
      sourceCanonical: true,
      status: "synced",
    });
    await runDirect(byId("collab.showStatus"));
    const detail = [...toasts].at(-1)!.detail ?? "";
    expect(detail).toContain("Status: synced");
    expect(detail).toContain("read access");
    expect(detail).toContain("This is not an error");
    expect(detail).toContain("never a collaborator's");
  });

  test("a failed attach carries its reason into the status", async () => {
    const tab = openShared();
    Object.assign(collabState(tab), { attachError: "relay unreachable", status: "failed" });
    await runDirect(byId("collab.showStatus"));
    expect([...toasts].at(-1)!.detail).toContain("relay unreachable");
  });
});

describe("with no document open", () => {
  /* Every verb is hidden by `when`, and every `run` guards again — because a command can be invoked
     through the registry, the palette's history or a script, and a guard that only exists in the
     predicate is a guard the API path does not have. */
  test("each verb is hidden, and running it anyway does nothing and says nothing", async () => {
    installMockPlatform();
    resetStudioState();
    closeAllTabs();
    for (const command of collabCommands()) {
      expect(command.when?.(emptyContext())).toBe(false);
      await runDirect(command, { enabled: true });
    }
    expect(messages()).toEqual([]);
  });

  test("follow and copyLink are also disabled, not merely hidden", () => {
    installMockPlatform();
    resetStudioState();
    closeAllTabs();
    expect(byId("collab.follow").enablement?.(emptyContext())).toBe(false);
    expect(byId("collab.copyLink").enablement?.(emptyContext())).toBe(false);
    expect(byId("collab.stop").enablement?.(emptyContext())).toBe(false);
  });
});
