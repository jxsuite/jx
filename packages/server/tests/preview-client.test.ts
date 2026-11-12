/**
 * The reload client's retarget, run the way a page runs it (`specs/server.md` §3.4).
 *
 * `PREVIEW_CLIENT_JS` is served as text, so nothing imports it and a behaviour of it is only a fact
 * once something executes the text. The one here is which of two things a `navigate` event does: a
 * reload in place, or a navigation. A harness address carries a component's test values in its
 * query, so "the tab is already there" has to mean the query too. Compared by path alone, a
 * retarget that dropped the values reloaded the address that still held them, and the editor
 * reported an updated tab that was showing the old ones.
 */

import { describe, expect, test } from "bun:test";
import { PREVIEW_CLIENT_JS } from "../src/preview-client";

/** Run the client at `href` and report what a `navigate` event to `route` made the tab do. */
function retarget(href: string, route: string) {
  const url = new URL(href);
  const done: string[] = [];
  const handlers = new Map<string, (event: { data: string }) => void>();
  /* The client calls `new EventSource(url)` and then sets handlers on what it gets back. */
  function StandInEventSource() {
    return {
      addEventListener: (name: string, handler: (event: { data: string }) => void) => {
        handlers.set(name, handler);
      },
      onerror: null,
      onmessage: null,
      onopen: null,
    };
  }
  const location = {
    assign: (to: string) => done.push(`assign ${to}`),
    href: url.href,
    pathname: url.pathname,
    reload: () => done.push("reload"),
    search: url.search,
  };
  const sessionStorage = { getItem: () => null, setItem: () => null };
  const fetched: string[] = [];
  const fetch = (to: string) => {
    fetched.push(to);
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  new Function(
    "EventSource",
    "location",
    "sessionStorage",
    "fetch",
    "addEventListener",
    "window",
    "scrollX",
    "scrollY",
    PREVIEW_CLIENT_JS,
  )(StandInEventSource, location, sessionStorage, fetch, () => null, { focus: () => null }, 0, 0);
  handlers.get("navigate")!({ data: JSON.stringify({ gen: 1, route }) });
  return { done, fetched };
}

const ORIGIN = "http://127.0.0.1:4100";
const CARD = "/__jx_live__/harness/components/user-card.json";
const ADA = `${CARD}?props=${encodeURIComponent('{"firstName":"Ada"}')}`;
const BOB = `${CARD}?props=${encodeURIComponent('{"firstName":"Bob"}')}`;

describe("a retarget", () => {
  test("to the address the tab is already at reloads in place, and is acknowledged first", () => {
    const page = retarget(`${ORIGIN}/blog/hello/`, "/blog/hello/");
    expect(page.done).toEqual(["reload"]);
    expect(page.fetched).toEqual(["/__jx_live__/ack"]);
  });

  test("to another route navigates there", () => {
    expect(retarget(`${ORIGIN}/blog/hello/`, "/about/").done).toEqual(["assign /about/"]);
  });

  test("to the same harness address, test values included, reloads in place", () => {
    expect(retarget(`${ORIGIN}${ADA}`, ADA).done).toEqual(["reload"]);
  });

  test("to the same address spelled another way still reloads in place", () => {
    /* `encodeURIComponent` leaves an apostrophe alone and a browser's query does not. */
    const sent = `${CARD}?props=${encodeURIComponent('{"firstName":"O\'Neil"}')}`;
    expect(sent).toContain("'");
    expect(retarget(`${ORIGIN}${sent}`, sent).done).toEqual(["reload"]);
  });

  test("to the same component with other test values navigates to them", () => {
    expect(retarget(`${ORIGIN}${ADA}`, BOB).done).toEqual([`assign ${BOB}`]);
  });

  test("to the same component with its test values cleared does not reload the old ones", () => {
    /* The path is the tab's own, and the address is not: a reload here would re-request the query
       the author just emptied. */
    expect(retarget(`${ORIGIN}${ADA}`, CARD).done).toEqual([`assign ${CARD}`]);
  });
});
