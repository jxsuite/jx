/**
 * A tab's remote data, kept by the host (`canvas/remote-data.ts`, studio.md §4.5): the session a
 * frame keys its answers on, the one frame that fetches, and what a Refresh forgets.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { installMockPlatform, resetStudioState, resetWorkspaceWithTab } from "./harness";
import {
  recordRemoteResult,
  refreshRemoteData,
  remoteSession,
  remoteSessionTabId,
  remoteWireFor,
  takeSourcesNotice,
} from "../src/canvas/remote-data";
import { activeTab } from "../src/workspace/workspace";
import type { RemoteResult } from "../src/canvas/iframe-protocol";

beforeEach(() => {
  resetStudioState();
  installMockPlatform();
});

const ANSWER: RemoteResult = { ok: true, value: [1] };
const always = () => true;

describe("a tab's remote session", () => {
  test("is named for the tab, and the name gives the tab back", () => {
    const tab = resetWorkspaceWithTab(undefined, { id: "page:with:colons" });
    expect(remoteSession(tab)).toBe("page:with:colons:0");
    expect(remoteSessionTabId(remoteSession(tab))).toBe("page:with:colons");
    expect(remoteSessionTabId("nameless")).toBe("");
  });

  test("is one session for the tab, whichever handle on it is used", () => {
    const raw = resetWorkspaceWithTab();
    const viaWorkspace = activeTab.value!;
    expect(recordRemoteResult(raw, remoteSession(raw), "k", ANSWER)).toBe(true);
    const host = {};
    expect(remoteWireFor(viaWorkspace, host, always).results).toEqual({ k: ANSWER });
  });

  test("keeps the first answer to a lookup, and none for a session that is over", () => {
    const tab = resetWorkspaceWithTab();
    const session = remoteSession(tab);
    expect(recordRemoteResult(tab, session, "k", ANSWER)).toBe(true);
    expect(recordRemoteResult(tab, session, "k", { error: "late", ok: false })).toBe(false);
    refreshRemoteData(tab);
    expect(recordRemoteResult(tab, session, "other", ANSWER)).toBe(false);
    expect(remoteWireFor(tab, {}, always).results).toEqual({});
  });

  test("Refresh forgets every answer and starts a session with another name", () => {
    const tab = resetWorkspaceWithTab();
    const before = remoteSession(tab);
    recordRemoteResult(tab, before, "k", ANSWER);
    refreshRemoteData(tab);
    const wire = remoteWireFor(tab, {}, always);
    expect(wire.session).not.toBe(before);
    expect(wire.results).toEqual({});
  });
});

describe("which frame fetches", () => {
  test("the first host asked, for as long as it is there; then the next one asked", () => {
    const tab = resetWorkspaceWithTab();
    const first = {};
    const second = {};
    const gone = new Set<WeakKey>();
    const isLive = (host: WeakKey) => !gone.has(host);
    expect(remoteWireFor(tab, first, isLive).fetch).toBe(true);
    expect(remoteWireFor(tab, second, isLive).fetch).toBe(false);
    expect(remoteWireFor(tab, first, isLive).fetch).toBe(true);
    // The fetching artboard goes away (a breakpoint removed, a pane closed).
    gone.add(first);
    expect(remoteWireFor(tab, second, isLive).fetch).toBe(true);
  });

  test("a Refresh lets the next host asked fetch, whoever fetched before", () => {
    const tab = resetWorkspaceWithTab();
    const first = {};
    const second = {};
    remoteWireFor(tab, first, always);
    refreshRemoteData(tab);
    expect(remoteWireFor(tab, second, always).fetch).toBe(true);
    expect(remoteWireFor(tab, first, always).fetch).toBe(false);
  });

  test("says whether the host has a backend to run a server function in", () => {
    const tab = resetWorkspaceWithTab();
    expect(remoteWireFor(tab, {}, always).server).toBe(false);
    installMockPlatform({ resolveClass: () => Promise.resolve(null) });
    expect(remoteWireFor(tab, {}, always).server).toBe(true);
  });
});

describe("takeSourcesNotice", () => {
  test("answers yes once per tab", () => {
    const tab = resetWorkspaceWithTab(undefined, { id: "a" });
    const asked = [takeSourcesNotice(tab), takeSourcesNotice(tab)];
    // Not once per session either: a Refresh does not make it news again.
    refreshRemoteData(tab);
    asked.push(takeSourcesNotice(tab));
    expect(asked).toEqual([true, false, false]);
  });
});
