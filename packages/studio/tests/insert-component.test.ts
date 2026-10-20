/**
 * Inserting a component has one meaning everywhere (`src/editor/insert-component.ts`,
 * specs/studio.md §5.7): an instance from `buildComponentInstance`, imported through the one
 * `$elements` service. The Insert panel's click, the slash menu, the canvas `+` and the canvas drop
 * all go through it.
 */
import { installMockPlatform, resetStudioState, resetWorkspaceWithTab } from "./harness";
import { beforeEach, describe, expect, test } from "bun:test";
import { loadComponentRegistry } from "../src/files/components";
import {
  COMPONENTS_GROUP,
  componentInstance,
  componentSlashCommands,
  mutateImportComponent,
} from "../src/editor/insert-component";
import { SITE_CARD } from "./shared-fixtures";
import { mutateInsertNode, transactDoc, undo } from "../src/tabs/transact";
import type { ComponentEntry } from "../src/files/components";
import type { StudioPlatform } from "../src/types";
import type { Tab } from "../src/tabs/tab";
import type { JxMutableNode } from "@jxsuite/schema/types";

const CARD = SITE_CARD;
const PACKAGE: ComponentEntry = {
  modulePath: "dist/acme-button.js",
  package: "@acme/widgets",
  props: [],
  source: "npm",
  tagName: "acme-button",
};

beforeEach(async () => {
  resetStudioState();
  /* SAFETY: the registry keeps this answer as `ComponentEntry[]`; the package entry mirrors the
     server's npm discovery, which sends `package` with no `path` (the cast the Insert panel's suite
     makes for the same reason). */
  const discoverComponents = (async () => [CARD, PACKAGE]) as StudioPlatform["discoverComponents"];
  installMockPlatform({ discoverComponents });
  await loadComponentRegistry();
});

/** The import alone, in a transaction of its own, as a door with no insert would make it. */
function importInto(tab: Tab, tagName: JxMutableNode["tagName"]): void {
  transactDoc(tab, (t) => mutateImportComponent(t, tagName));
}

describe("mutateImportComponent", () => {
  test("imports a registered component once", () => {
    const tab = resetWorkspaceWithTab(
      { children: [], tagName: "div" },
      { documentPath: "pages/index.json" },
    );
    importInto(tab, "site-card");
    expect(tab.doc.document.$elements).toEqual([{ $ref: "../components/site-card.json" }]);
    importInto(tab, "site-card");
    expect(tab.doc.document.$elements).toHaveLength(1);
  });

  test("leaves an HTML element, a computed tag and an unknown component alone", () => {
    const tab = resetWorkspaceWithTab({ children: [], tagName: "div" });
    importInto(tab, "section");
    importInto(tab, {
      $expression: { cases: { a: "site-card" }, default: "div", operator: "switch", target: "a" },
    });
    importInto(tab, "never-registered");
    expect(tab.doc.document.$elements).toBeUndefined();
  });
});

describe("mutateImportComponent, in the insert's transaction", () => {
  test("inside the insert's transaction, one undo takes back the instance AND its import", () => {
    const tab = resetWorkspaceWithTab(
      { children: [{ tagName: "p", textContent: "x" }], tagName: "div" },
      { documentPath: "pages/index.json" },
    );
    transactDoc(tab, (t) => {
      mutateInsertNode(t, [], 1, { tagName: "site-card" });
      mutateImportComponent(t, "site-card");
    });
    expect(tab.doc.document.$elements).toEqual([{ $ref: "../components/site-card.json" }]);
    expect(tab.doc.document.children).toHaveLength(2);
    undo(tab);
    expect(tab.doc.document.$elements).toBeUndefined();
    expect(tab.doc.document.children).toHaveLength(1);
  });

  test("a component already imported writes nothing beside its insert", () => {
    const tab = resetWorkspaceWithTab(
      { $elements: [{ $ref: "../components/site-card.json" }], children: [], tagName: "div" },
      { documentPath: "pages/index.json" },
    );
    transactDoc(tab, (t) => {
      mutateInsertNode(t, [], 0, { tagName: "site-card" });
      mutateImportComponent(t, "site-card");
    });
    expect(tab.doc.document.$elements).toHaveLength(1);
  });
});

describe("componentInstance", () => {
  test("is a fresh instance with its prop defaults, or null for an unknown tag", () => {
    expect(componentInstance("site-card")).toEqual({
      $props: { heading: "Hi" },
      tagName: "site-card",
    });
    expect(componentInstance("never-registered")).toBeNull();
  });
});

describe("componentSlashCommands", () => {
  test("lists every component under the Components heading, a package one by its package", () => {
    expect(componentSlashCommands()).toEqual([
      {
        component: true,
        description: "components/site-card.json",
        group: COMPONENTS_GROUP,
        label: "<site-card>",
        tag: "site-card",
      },
      {
        component: true,
        description: "@acme/widgets",
        group: COMPONENTS_GROUP,
        label: "<acme-button>",
        tag: "acme-button",
      },
    ]);
  });
});
