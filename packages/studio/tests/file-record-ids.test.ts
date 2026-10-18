/** Tests for src/content/file-record-ids.ts: the ids the content loader gives a file's records. */
import { describe, expect, test } from "bun:test";
import { fileRecordIds } from "../src/content/file-record-ids";

describe("fileRecordIds", () => {
  test("a CSV row is named by its idField, then id, sku, slug, Slug, then its place", () => {
    const csv = ["Title,code,Slug,sku", "A,c-a,s-a,k-a", "B,,s-b,", "C,,,", ",,,", "D,c-d,,"].join(
      "\n",
    );
    expect(fileRecordIds("content/p.csv", csv, "code")).toEqual(["c-a", "s-b", "2", "c-d"]);
    expect(fileRecordIds("content/p.csv", csv)).toEqual(["k-a", "s-b", "2", "3"]);
    expect(fileRecordIds("content/p.csv", "Title\n")).toEqual([]);
  });

  test("a JSON array's object is named by its id, else <stem>-<n>", () => {
    const json = JSON.stringify([{ id: "x" }, { id: 7 }, { name: "n" }, "scalar", [1]]);
    expect(fileRecordIds("content/team.JSON", json)).toEqual([
      "x",
      "7",
      "team-2",
      "team-3",
      "team-4",
    ]);
  });

  test("JSON that is not an array, broken JSON and other kinds hold no records", () => {
    expect(fileRecordIds("content/one.json", '{"id":"a"}')).toEqual([]);
    expect(fileRecordIds("content/one.json", "{")).toEqual([]);
    expect(fileRecordIds("content/notes.md", "# hi")).toEqual([]);
  });
});
