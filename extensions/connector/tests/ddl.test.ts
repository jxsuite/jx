/**
 * DDL — additive-only sync over real bun:sqlite: creation, idempotence, column additions, junction
 * tables (relationships.md §3), drift warnings, and dry-run compilation.
 */

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Kysely, sql } from "kysely";
import { createBunSqliteDialect } from "../src/dialects/bun-sqlite";
import { syncTables } from "../src/ddl";
import type { DynamicDatabase } from "../src/query";
import type { TableDef } from "../src/types";

function makeDb(): Kysely<DynamicDatabase> {
  return new Kysely<DynamicDatabase>({
    dialect: createBunSqliteDialect({ database: new Database(":memory:") }),
  });
}

const COMMENTS = {
  comments: {
    connection: "main",
    indexes: ["views"],
    schema: {
      properties: {
        approved: { type: "boolean" },
        message: { type: "string" },
        views: { type: "integer" },
      },
      required: ["message"],
      type: "object",
    },
  },
} satisfies Record<string, TableDef>;

describe("syncTables", () => {
  test("creates tables with id, timestamps, columns, and indexes", async () => {
    const db = makeDb();
    const result = await syncTables(db, COMMENTS, { dialect: "sqlite" });
    expect(result.applied).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.statements.some((s) => s.startsWith('create table "comments"'))).toBe(true);
    expect(result.statements.some((s) => s.includes("comments_views_idx"))).toBe(true);

    const tables = await db.introspection.getTables();
    const columns = tables.find((t) => t.name === "comments")!.columns.map((c) => c.name);
    expect(columns.toSorted()).toEqual([
      "approved",
      "created_at",
      "id",
      "message",
      "updated_at",
      "views",
    ]);
    await db.destroy();
  });

  test("second run is a no-op (idempotence)", async () => {
    const db = makeDb();
    await syncTables(db, COMMENTS, { dialect: "sqlite" });
    const second = await syncTables(db, COMMENTS, { dialect: "sqlite" });
    expect(second.statements).toEqual([]);
    expect(second.warnings).toEqual([]);
    await db.destroy();
  });

  test("dryRun compiles statements without applying them", async () => {
    const db = makeDb();
    const result = await syncTables(db, COMMENTS, { dialect: "sqlite", dryRun: true });
    expect(result.applied).toBe(false);
    expect(result.statements.length).toBeGreaterThan(0);
    const tables = await db.introspection.getTables();
    expect(tables).toEqual([]);
    await db.destroy();
  });

  test("adds missing columns additively; never drops or retypes", async () => {
    const db = makeDb();
    await syncTables(db, COMMENTS, { dialect: "sqlite" });
    // Simulate drift: an extra column and a wrong-typed schema change.
    await sql`alter table comments add column legacy text`.execute(db);
    const evolved = {
      comments: {
        connection: "main",
        schema: {
          properties: {
            message: { type: "integer" },
            rating: { type: "number" },
            views: { type: "integer" },
          },
          type: "object",
        },
      },
    } satisfies Record<string, TableDef>;
    const result = await syncTables(db, evolved, { dialect: "sqlite" });
    expect(result.statements).toEqual(['alter table "comments" add column "rating" real']);
    expect(result.warnings.some((w) => w.includes("comments.message: type drift"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("comments.legacy"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("comments.approved"))).toBe(true);

    const tables = await db.introspection.getTables();
    const columns = tables.find((t) => t.name === "comments")!.columns.map((c) => c.name);
    expect(columns).toContain("approved");
    expect(columns).toContain("legacy");
    expect(columns).toContain("rating");
    await db.destroy();
  });

  test("turning timestamps on for an existing table adds the two columns additively", async () => {
    const db = makeDb();
    const noStamps = {
      posts: {
        connection: "main",
        schema: { properties: { title: { type: "string" } }, type: "object" },
        timestamps: false,
      },
    } satisfies Record<string, TableDef>;
    await syncTables(db, noStamps, { dialect: "sqlite" });
    const withStamps = {
      posts: { ...noStamps.posts, timestamps: true },
    } satisfies Record<string, TableDef>;
    const result = await syncTables(db, withStamps, { dialect: "sqlite" });
    expect(result.statements.toSorted()).toEqual([
      'alter table "posts" add column "created_at" text',
      'alter table "posts" add column "updated_at" text',
    ]);
    const tables = await db.introspection.getTables();
    const columns = tables.find((t) => t.name === "posts")!.columns.map((c) => c.name);
    expect(columns).toContain("created_at");
    expect(columns).toContain("updated_at");
    await db.destroy();
  });

  test("integer id tables get autoincrement primary keys on sqlite", async () => {
    const db = makeDb();
    const tables = {
      posts: {
        connection: "main",
        id: "integer",
        schema: { properties: { title: { type: "string" } }, type: "object" },
        timestamps: false,
      },
    } satisfies Record<string, TableDef>;
    const result = await syncTables(db, tables, { dialect: "sqlite" });
    expect(result.statements[0]).toContain("autoincrement");
    await db.insertInto("posts").values({ title: "a" }).execute();
    await db.insertInto("posts").values({ title: "b" }).execute();
    const rows = await db.selectFrom("posts").selectAll().execute();
    expect(rows.map((r) => r.id)).toEqual([1, 2]);
    await db.destroy();
  });

  test("materializes junction tables with composite PK and target index", async () => {
    const db = makeDb();
    const tables = {
      posts: {
        connection: "main",
        schema: {
          properties: {
            tags: { items: { $ref: "#/data/tags" }, type: "array" },
            title: { type: "string" },
          },
          type: "object",
        },
      },
      tags: {
        connection: "main",
        schema: { properties: { name: { type: "string" } }, type: "object" },
      },
    } satisfies Record<string, TableDef>;
    const result = await syncTables(db, tables, { dialect: "sqlite" });
    expect(
      result.statements.some(
        (s) => s.startsWith('create table "posts_tags"') && s.includes("primary key"),
      ),
    ).toBe(true);
    expect(result.statements.some((s) => s.includes("posts_tags_tags_id_idx"))).toBe(true);

    const introspected = await db.introspection.getTables();
    const names = introspected.map((t) => t.name);
    expect(names).toContain("posts_tags");

    // Idempotent for junctions too.
    const second = await syncTables(db, tables, { dialect: "sqlite" });
    expect(second.statements).toEqual([]);
    await db.destroy();
  });

  test("reports orphaned junction tables as drift, never drops them", async () => {
    const db = makeDb();
    await sql`create table posts (id text primary key)`.execute(db);
    await sql`create table posts_oldtags (posts_id text, tags_id text)`.execute(db);
    const tables = {
      posts: {
        connection: "main",
        schema: { properties: { title: { type: "string" } }, type: "object" },
        timestamps: false,
      },
    } satisfies Record<string, TableDef>;
    const result = await syncTables(db, tables, { dialect: "sqlite" });
    expect(result.warnings.some((w) => w.includes("posts_oldtags") && w.includes("orphaned"))).toBe(
      true,
    );
    const introspected = await db.introspection.getTables();
    const names = introspected.map((t) => t.name);
    expect(names).toContain("posts_oldtags");
    await db.destroy();
  });

  test("postgres flavor compiles identity ids and pg types in dry-run", async () => {
    const db = makeDb();
    const tables = {
      metrics: {
        connection: "main",
        id: "integer",
        schema: {
          properties: { flag: { type: "boolean" }, score: { type: "number" } },
          type: "object",
        },
        timestamps: false,
      },
    } satisfies Record<string, TableDef>;
    const result = await syncTables(db, tables, { dialect: "postgres", dryRun: true });
    const [create] = result.statements;
    expect(create).toContain("generated always as identity");
    expect(create).toContain("double precision");
    expect(create).toContain('"flag" boolean');
    await db.destroy();
  });
});

describe("foreign keys", () => {
  const users = {
    connection: "main",
    id: "integer",
    schema: { properties: { name: { type: "string" } }, type: "object" },
  } satisfies TableDef;
  const comments = {
    connection: "main",
    schema: {
      properties: { author: { $ref: "#/data/users" }, message: { type: "string" } },
      type: "object",
    },
  } satisfies TableDef;

  test("a to-one reference creates a keyed column the database enforces", async () => {
    const db = makeDb();
    const result = await syncTables(db, { comments, users }, { dialect: "sqlite" });
    const create = result.statements.find((s) => s.startsWith('create table "comments"'))!;
    expect(create).toContain('"author_id" integer references "users" ("id") on delete set null');
    const keys = await sql<{
      table: string;
    }>`select "table" from pragma_foreign_key_list('comments')`.execute(db);
    expect(keys.rows.map((r) => r.table)).toEqual(["users"]);
    await sql`insert into users (name) values ('a')`.execute(db);
    expect(
      sql`insert into comments (id, author_id) values ('x', 99)`.execute(db),
    ).rejects.toThrow();
    await sql`insert into comments (id, author_id) values ('x', 1)`.execute(db);
    await sql`delete from users where id = 1`.execute(db);
    const left = await sql<{ author_id: number | null }>`select author_id from comments`.execute(
      db,
    );
    expect(left.rows[0]!.author_id).toBeNull();
  });

  test("targets are created before the tables that reference them", async () => {
    const result = await syncTables(
      makeDb(),
      { comments, loose: { ...users, id: "uuid" }, users },
      { dialect: "sqlite", dryRun: true },
    );
    const creates = result.statements
      .filter((s) => s.startsWith("create table"))
      .map((s) => s.split('"')[1]);
    expect(creates).toEqual(["loose", "users", "comments"]);
  });

  test("adding a reference field to an existing table adds the column with its key", async () => {
    const db = makeDb();
    const bare = {
      ...comments,
      schema: { properties: { message: { type: "string" } }, type: "object" },
    } satisfies TableDef;
    await syncTables(db, { comments: bare, users }, { dialect: "sqlite" });
    const added = await syncTables(db, { comments, users }, { dialect: "sqlite" });
    expect(added.statements).toEqual([
      'alter table "comments" add column "author_id" integer references "users" ("id") on delete set null',
    ]);
    const again = await syncTables(db, { comments, users }, { dialect: "sqlite" });
    expect(again.statements).toEqual([]);
    expect(again.warnings).toEqual([]);
  });

  test("a legacy text reference column onto an integer target is one drift warning", async () => {
    const db = makeDb();
    await sql`create table users (id integer primary key, name text, created_at text, updated_at text)`.execute(
      db,
    );
    await sql`create table comments (id text primary key, created_at text, updated_at text, message text, author_id text)`.execute(
      db,
    );
    const result = await syncTables(db, { comments, users }, { dialect: "sqlite" });
    expect(result.statements).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    const [warning] = result.warnings;
    for (const part of ["TEXT", "with no foreign key", "integer", 'referencing "users"']) {
      expect(warning).toContain(part);
    }
    const info = await sql<{
      type: string;
    }>`select type from pragma_table_info('comments') where name = 'author_id'`.execute(db);
    expect(info.rows[0]!.type).toBe("TEXT");
  });

  test("postgres dry-run keys inline and defers only a cycle's back edge", async () => {
    const a = {
      connection: "main",
      schema: { properties: { b: { $ref: "#/data/b" } }, type: "object" },
    } satisfies TableDef;
    const b = {
      connection: "main",
      schema: { properties: { a: { $ref: "#/data/a" } }, type: "object" },
    } satisfies TableDef;
    const tree = {
      connection: "main",
      schema: { properties: { parent: { $ref: "#/data/tree" } }, type: "object" },
    } satisfies TableDef;
    const result = await syncTables(
      makeDb(),
      { a, b, tree },
      { dialect: "postgres", dryRun: true },
    );
    expect(result.statements.find((s) => s.startsWith('create table "b"'))).toContain(
      'references "a"',
    );
    expect(result.statements.find((s) => s.startsWith('create table "tree"'))).toContain(
      'references "tree"',
    );
    expect(result.statements.find((s) => s.startsWith('create table "a"'))).not.toContain(
      "references",
    );
    expect(result.statements.at(-1)).toBe(
      'alter table "a" add constraint "a_b_id_fkey" foreign key ("b_id") references "b" ("id") on delete set null',
    );
  });

  test("postgres catalog names are not drift, and an unreadable key catalog reports no key drift", async () => {
    const db = makeDb();
    await sql`create table things (id text primary key, created_at text, updated_at text, n int4, x float8, flag bool, author_id text)`.execute(
      db,
    );
    await sql`create table users (id text primary key, created_at text, updated_at text)`.execute(
      db,
    );
    const things = {
      connection: "main",
      schema: {
        properties: {
          author: { $ref: "#/data/users" },
          flag: { type: "boolean" },
          n: { type: "integer" },
          x: { type: "number" },
        },
        type: "object",
      },
    } satisfies TableDef;
    const plain = {
      connection: "main",
      schema: { properties: {}, type: "object" },
    } satisfies TableDef;
    const result = await syncTables(
      db,
      { things, users: plain },
      { dialect: "postgres", dryRun: true },
    );
    expect(result.warnings).toEqual([]);
  });
});
