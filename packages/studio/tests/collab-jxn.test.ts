/**
 * A `.jxn` document in a collaboration session (studio.md §8.5, collab.md §3.1): what this client
 * writes into the shared text is merged over the room's CURRENT text, so a comment a peer typed in
 * the Code view survives a style edit made here, and the room holds one text throughout.
 */
import { installMockPlatform } from "./harness";
import { createMockCollabHub, settleCollab } from "./collab-mock";
import { closeAllTabs, openTab } from "../src/workspace/workspace";
import {
  collabSave,
  configureCollabSerializer,
  resetCollabForTests,
} from "../src/collab/collab-session";
import { collabState } from "../src/collab/collab-state";
import { serializeDocument } from "../src/files/serialize-document";
import { LOCAL_ORIGIN, sourceText, updateSourceText } from "@jxsuite/collab";
import { parseJxn } from "@jxsuite/schema/jxn";
import { afterEach, describe, expect, test } from "bun:test";

const PATH = "pages/team.jxn";
const TEXT = '/- kdl-version 2\n\nmain {\n    style padding="2rem"\n    h1 Team\n}\n';

afterEach(() => {
  closeAllTabs();
  resetCollabForTests();
});

describe("a .jxn document shared in a session", () => {
  test("a peer's comment survives a style edit made here", async () => {
    const hub = createMockCollabHub();
    installMockPlatform({ collab: hub.capability }, { [PATH]: TEXT });
    configureCollabSerializer(serializeDocument);
    const tab = openTab({
      document: parseJxn(TEXT),
      documentPath: PATH,
      id: PATH,
      source: TEXT,
      sourceFormat: "jxn",
    });
    await settleCollab();
    expect(collabState(tab).active).toBe(true);

    // The room's text is this file, and a peer adds a comment to it in the Code view.
    const peer = (await hub.capability(PATH))!;
    updateSourceText(peer.doc, TEXT, LOCAL_ORIGIN);
    const commented = TEXT.replace("main {", "// The team, in one line.\nmain {");
    updateSourceText(peer.doc, commented, LOCAL_ORIGIN);
    await settleCollab();

    // This client still holds the text it read, and edits a style.
    tab.doc.document.style = { padding: "3rem" };
    expect(await collabSave(tab)).toBe(true);
    await settleCollab();

    expect(sourceText(peer.doc).toString()).toBe(commented.replace("2rem", "3rem"));
    peer.destroy();
  });
});
