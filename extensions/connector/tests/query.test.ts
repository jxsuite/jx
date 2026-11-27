/**
 * Query — the content filter grammar over Kysely, exercised with real SQL against in-memory
 * bun:sqlite (plan Part 4a "query.ts": content.ts filter grammar → where()).
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from "kysely";
import { planTable } from "../src/columns";
import { createBunSqliteDialect } from "../src/dialects/bun-sqlite";
import {
  applyFilter,
  applySort,
  columnForField,
  normalizeFilter,
  normalizeSort,
} from "../src/query";
import type { JsonValue } from "@jxsuite/schema/types";
import type { DynamicDatabase, FilterRule } from "../src/query";
import type { TableDef } from "../src/types";

const TABLES = {
  comments: {
    connection: "main",
    schema: {
      properties: {
        approved: { type: "boolean" },
        author: { $ref: "#/data/users" },
        message: { type: "string" },
        tags: { items: { type: "string" }, type: "array" },
        views: { type: "integer" },
      },
      type: "object",
    },
    timestamps: false,
  },
  users: { connection: "main", schema: { properties: {}, type: "object" } },
} satisfies Record<string, TableDef>;

const plan = planTable("comments", TABLES.comments!, TABLES, "sqlite");
let db: Kysely<DynamicDatabase>;

beforeAll(async () => {
  db = new Kysely<DynamicDatabase>({
    dialect: createBunSqliteDialect({ database: new Database(":memory:") }),
  });
  await db.schema
    .createTable("comments")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("message", "text")
    .addColumn("views", "integer")
    .addColumn("approved", "integer")
    .addColumn("tags", "text")
    .addColumn("author_id", "text")
    .execute();
  const rows = [
    { approved: 1, author_id: "u1", id: "a", message: "great post", tags: '["x","y"]', views: 10 },
    { approved: 0, author_id: "u2", id: "b", message: "meh", tags: "[]", views: 3 },
    { approved: 1, author_id: null, id: "c", message: null, tags: null, views: 7 },
    { approved: 0, author_id: "u1", id: "d", message: "", tags: '["y"]', views: 5 },
  ];
  for (const row of rows) {
    await db.insertInto("comments").values(row).execute();
  }
});

/** The ids of the rows a filter (and optional sort) selects, in result order. */
async function ids(filter: JsonValue, sort?: JsonValue) {
  let qb = db.selectFrom("comments").selectAll();
  qb = applyFilter(qb, normalizeFilter(filter), plan.columns);
  qb = applySort(qb, normalizeSort(sort ?? { field: "id", order: "asc" }), plan.columns);
  const rows = await qb.execute();
  return rows.map((r) => r.id);
}

describe("normalizeFilter / normalizeSort", () => {
  test("object shorthand becomes equality rules; junk drops", () => {
    expect(normalizeFilter({ approved: true })).toEqual([
      { field: "approved", op: "==", value: true },
    ]);
    expect(normalizeFilter([{ field: "views", op: ">", value: 4 }, { nope: 1 }])).toEqual([
      { field: "views", op: ">", value: 4 },
    ]);
    expect(normalizeFilter("bogus")).toEqual([]);
    expect(normalizeSort({ field: "views" })).toEqual([{ field: "views" }]);
    expect(normalizeSort(null)).toEqual([]);
  });
});

describe("columnForField", () => {
  test("maps reference fields to their FK columns and passes id through", () => {
    expect(columnForField("author", plan.columns)).toBe("author_id");
    expect(columnForField("id", plan.columns)).toBe("id");
    expect(columnForField("unknown", plan.columns)).toBe("unknown");
  });
});

describe("filter ops over real SQL", () => {
  test("== coerces booleans to storage and matches", async () => {
    expect(await ids({ approved: true })).toEqual(["a", "c"]);
    expect(await ids([{ field: "views", op: "==", value: 3 }])).toEqual(["b"]);
  });

  test("== null matches IS NULL", async () => {
    expect(await ids([{ field: "message", op: "==", value: null }])).toEqual(["c"]);
  });

  test("!= includes NULL rows (in-memory grammar parity)", async () => {
    expect(await ids([{ field: "message", op: "!=", value: "meh" }])).toEqual(["a", "c", "d"]);
    expect(await ids([{ field: "message", op: "!=", value: null }])).toEqual(["a", "b", "d"]);
  });

  test("empty / not empty treat '', NULL, and [] as empty", async () => {
    expect(await ids([{ field: "message", op: "empty" }])).toEqual(["c", "d"]);
    expect(await ids([{ field: "tags", op: "empty" }])).toEqual(["b", "c"]);
    expect(await ids([{ field: "tags", op: "not empty" }])).toEqual(["a", "d"]);
  });

  test("contains matches substrings and JSON elements", async () => {
    expect(await ids([{ field: "message", op: "contains", value: "post" }])).toEqual(["a"]);
    expect(await ids([{ field: "tags", op: "contains", value: "y" }])).toEqual(["a", "d"]);
    expect(await ids([{ field: "message", op: "not contains", value: "post" }])).toEqual([
      "b",
      "c",
      "d",
    ]);
  });

  test("numeric comparisons", async () => {
    expect(await ids([{ field: "views", op: ">", value: 5 }])).toEqual(["a", "c"]);
    expect(await ids([{ field: "views", op: "<=", value: "5" }])).toEqual(["b", "d"]);
    expect(await ids([{ field: "views", op: "<", value: 5 }])).toEqual(["b"]);
    expect(await ids([{ field: "views", op: ">=", value: 7 }])).toEqual(["a", "c"]);
  });

  test("reference fields filter through their FK column", async () => {
    expect(await ids([{ field: "author", op: "==", value: "u1" }])).toEqual(["a", "d"]);
  });

  test("== against a JSON-storage column compares the encoded value", async () => {
    expect(await ids([{ field: "tags", op: "==", value: ["x", "y"] }])).toEqual(["a"]);
  });

  test("a boolean probe against a non-boolean column still coerces, rather than crashing", async () => {
    // `views` is integer storage; a stray boolean value falls through storageValue's generic
    // Boolean branch (1/0), not the column's own storage-boolean coercion.
    expect(await ids([{ field: "views", op: "==", value: true }])).toEqual([]);
  });

  test("multiple rules AND together; unknown ops match everything", async () => {
    expect(
      await ids([
        { field: "approved", op: "==", value: true },
        { field: "views", op: ">", value: 8 },
      ]),
    ).toEqual(["a"]);
    expect(await ids([{ field: "views", op: "~~", value: 1 }])).toEqual(["a", "b", "c", "d"]);
  });
});

describe("sort", () => {
  test("orders by column with asc default and desc on request", async () => {
    expect(await ids(null, { field: "views" })).toEqual(["b", "d", "c", "a"]);
    expect(await ids(null, { field: "views", order: "desc" })).toEqual(["a", "c", "d", "b"]);
    expect(
      await ids(null, [
        { field: "approved", order: "desc" },
        { field: "views", order: "asc" },
      ]),
    ).toEqual(["c", "a", "b", "d"]);
  });
});

describe("a keyed integer reference column", () => {
  const tables = {
    comments: {
      connection: "main",
      schema: { properties: { author: { $ref: "#/data/users" } }, type: "object" },
      timestamps: false,
    },
    users: { connection: "main", id: "integer", schema: { properties: {}, type: "object" } },
  } satisfies Record<string, TableDef>;
  const keyed = planTable("comments", tables.comments!, tables, "postgres");

  const pg = new Kysely<DynamicDatabase>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (k) => new PostgresIntrospector(k),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  const compile = (rules: FilterRule[]) =>
    applyFilter(pg.selectFrom("comments").selectAll(), rules, keyed.columns).compile();

  test("filters without a Postgres cast error", () => {
    const eq = compile([{ field: "author", op: "==", value: "7" }]);
    expect(eq.parameters).toEqual([7]);
    const bad = compile([{ field: "author", op: "==", value: "abc" }]);
    expect(bad.sql).toContain("where false");
    expect(bad.parameters).toEqual([]);
    const ne = compile([{ field: "author", op: "!=", value: "abc" }]);
    expect(ne.sql).toContain("where true");
    expect(compile([{ field: "author", op: "!=", value: "7" }]).parameters).toEqual([7]);
    expect(compile([{ field: "author", op: "empty" }]).sql).toContain('"author_id" is null');
    expect(compile([{ field: "author", op: "not empty" }]).sql).toContain(
      '"author_id" is not null',
    );
    expect(compile([{ field: "author", op: "contains", value: "7" }]).sql).toContain(
      'cast("author_id" as text) like',
    );
    expect(compile([{ field: "author", op: "not contains", value: "7" }]).sql).toContain(
      'cast("author_id" as text) not like',
    );
    // A null probe and an unlisted op keep today's expressions.
    expect(compile([{ field: "author", op: "==", value: null }]).sql).toContain("is null");
    expect(compile([{ field: "author", op: ">", value: "1" }]).parameters).toEqual([1]);
  });

  test("matches an integer column over real SQLite", async () => {
    const lite = new Kysely<DynamicDatabase>({
      dialect: createBunSqliteDialect({ database: new Database(":memory:") }),
    });
    await lite.schema
      .createTable("comments")
      .addColumn("id", "text")
      .addColumn("author_id", "integer")
      .execute();
    await lite
      .insertInto("comments")
      .values([
        { author_id: 1, id: "a" },
        { author_id: 2, id: "b" },
      ])
      .execute();
    const found = await applyFilter(
      lite.selectFrom("comments").selectAll(),
      [{ field: "author", op: "==", value: "1" }],
      keyed.columns,
    ).execute();
    expect(found.map((r) => r.id)).toEqual(["a"]);
  });
});
