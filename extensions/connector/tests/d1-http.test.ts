/**
 * D1-http dialect — SQL forwarding to the Cloudflare HTTP API with a mocked fetch: request shape,
 * row/meta mapping, and error surfacing.
 */

import { describe, expect, test } from "bun:test";
import { Kysely, sql } from "kysely";
import { createD1HttpDialect } from "../src/dialects/d1-http";
import type { JsonObject, JsonValue } from "@jxsuite/schema/types";
import type { DynamicDatabase } from "../src/query";

interface Captured {
  url: string;
  headers: Headers;
  body: JsonValue;
}

/** Decode a posted request body: `JSON.parse` only ever yields JSON values. */
function parseBody(init: RequestInit | undefined): JsonValue {
  return JSON.parse(String(init?.body));
}

/** A whole `fetch` double: `handler` answers every request, and Bun's `preconnect` rides along. */
function fakeFetch(
  handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): typeof globalThis.fetch {
  const { preconnect } = globalThis.fetch;
  return Object.assign(handler, { preconnect });
}

function makeDb(responder: (captured: Captured) => Response) {
  const calls: Captured[] = [];
  const fetch = fakeFetch(async (input, init) => {
    const captured: Captured = {
      body: parseBody(init),
      headers: new Headers(init?.headers),
      url: String(input),
    };
    calls.push(captured);
    return responder(captured);
  });
  const db = new Kysely<DynamicDatabase>({
    dialect: createD1HttpDialect({
      accountId: "acct",
      apiToken: "tok",
      databaseId: "db-uuid",
      fetch,
    }),
  });
  return { calls, db };
}

function d1Ok(results: JsonObject[], meta: JsonObject = {}) {
  return Response.json({ result: [{ meta, results, success: true }], success: true });
}

describe("createD1HttpDialect", () => {
  test("POSTs sql + params to the account/database endpoint with the bearer token", async () => {
    const { calls, db } = makeDb(() => d1Ok([{ id: "a", n: 1 }]));
    const rows = await db.selectFrom("t").selectAll().where("id", "=", "a").execute();
    expect(rows).toEqual([{ id: "a", n: 1 }]);

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct/d1/database/db-uuid/query",
    );
    expect(call!.headers.get("Authorization")).toBe("Bearer tok");
    expect(call!.body).toEqual({ params: ["a"], sql: 'select * from "t" where "id" = ?' });
  });

  test("maps meta.changes and meta.last_row_id to Kysely result fields", async () => {
    const { db } = makeDb(() => d1Ok([], { changes: 2, last_row_id: 7 }));
    const result = await db.deleteFrom("t").where("id", "=", "x").executeTakeFirst();
    expect(result.numDeletedRows).toBe(2n);
  });

  test("surfaces API error messages", async () => {
    const { db } = makeDb(() =>
      Response.json(
        { errors: [{ code: 7500, message: "no such table: nope" }], success: false },
        { status: 400 },
      ),
    );
    expect(sql`select 1`.execute(db)).rejects.toThrow("no such table: nope");
  });

  test("falls back to the HTTP status when the body is not JSON", async () => {
    const { db } = makeDb(() => new Response("boom", { status: 502 }));
    expect(sql`select 1`.execute(db)).rejects.toThrow("HTTP 502");
  });

  test("supports a baseUrl override and rejects transactions", async () => {
    const calls: string[] = [];
    const fetch = fakeFetch(async (input) => {
      calls.push(String(input));
      return d1Ok([]);
    });
    const db = new Kysely<DynamicDatabase>({
      dialect: createD1HttpDialect({
        accountId: "a",
        apiToken: "t",
        baseUrl: "http://localhost:8787",
        databaseId: "d",
        fetch,
      }),
    });
    await sql`select 1`.execute(db);
    expect(calls[0]).toStartWith("http://localhost:8787/client/v4/accounts/a/");

    expect(
      db.transaction().execute(async (trx) => {
        await sql`select 1`.execute(trx);
        throw new Error("force rollback");
      }),
    ).rejects.toThrow();

    // Begin/commit are per-statement no-ops; a successful transaction just runs its queries.
    const committed = await db.transaction().execute(async (trx) => {
      await sql`select 1`.execute(trx);
      return "done";
    });
    expect(committed).toBe("done");
    await db.destroy();
  });

  test("rejects streaming — the HTTP API has no cursor to stream from", async () => {
    const { db } = makeDb(() => d1Ok([{ id: "a" }]));
    let caught: Error | null = null;
    try {
      for await (const _row of db.selectFrom("t").selectAll().stream()) {
        // Unreachable: streamQuery throws before yielding anything.
      }
    } catch (error) {
      // A non-Error rejection leaves `caught` null, which the first assertion reports.
      if (error instanceof Error) {
        caught = error;
      }
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toContain("does not support streaming");
  });
});
