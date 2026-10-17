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
  importComponentInto,
} from "../src/editor/insert-component";
import { SITE_CARD } from "./shared-fixtures";
import type { ComponentEntry } from "../src/files/components";
import type { StudioPlatform } from "../src/types";

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

describe("importComponentInto", () => {
  test("imports a registered component once", () => {
    const tab = resetWorkspaceWithTab(
      { children: [], tagName: "div" },
      { documentPath: "pages/index.json" },
    );
    importComponentInto(tab, "site-card");
    expect(tab.doc.document.$elements).toEqual([{ $ref: "../components/site-card.json" }]);
    importComponentInto(tab, "site-card");
    expect(tab.doc.document.$elements).toHaveLength(1);
  });

  test("leaves an HTML element, a computed tag and an unknown component alone", () => {
    const tab = resetWorkspaceWithTab({ children: [], tagName: "div" });
    importComponentInto(tab, "section");
    importComponentInto(tab, {
      $expression: { cases: { a: "site-card" }, default: "div", operator: "switch", target: "a" },
    });
    importComponentInto(tab, "never-registered");
    expect(tab.doc.document.$elements).toBeUndefined();
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
