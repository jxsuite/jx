/**
 * The Data panel's value tree specimen: one state entry's value, a list cut short by its limit
 * (studio.md §4.6).
 */
import { reactive } from "../reactivity";
import { defineSpecimen } from "./specimen";
import type { DataTreeRow, DataTreeScope } from "./panel-data";

/** One value line of the tree. */
function line(key: string, depth: number, label: string, text: string, tone: string): DataTreeRow {
  return {
    indent: `${depth * 12}px`,
    key,
    kind: "row",
    label,
    limit: "",
    path: "",
    text,
    title: "",
    tone,
  };
}

/** The tree over `posts`, three of five items shown. */
function tree(rows: DataTreeRow[]): DataTreeScope {
  const scope: DataTreeScope = reactive<DataTreeScope>({
    rows,
    showMore: (path, limit) => {
      scope.rows = scope.rows.filter((row) => row.path !== path || row.limit !== limit);
    },
  });
  return scope;
}

/** The lines of the default tree. */
function posts(): DataTreeRow[] {
  return [
    line("posts", 0, "posts: ", "Array(5)", "object"),
    line("posts.0", 1, "[0] ", "{3}", "object"),
    line("posts.0.title", 2, "title: ", '"Shipping the canvas"', "string"),
    line("posts.0.words", 2, "words: ", "1840", "number"),
    line("posts.0.draft", 2, "draft: ", "false", "boolean"),
    line("posts.1", 1, "[1] ", "{3}", "object"),
    line("posts.2", 1, "[2] ", "null", "null"),
    {
      indent: "12px",
      key: "posts.more",
      kind: "more",
      label: "",
      limit: "items",
      path: "posts",
      text: "2 more items",
      title: "Show 2 more items of posts",
      tone: "",
    },
  ];
}

export const specimen = defineSpecimen<DataTreeScope>({
  drive: (root) => {
    root.querySelector<HTMLElement>('[part="more"]')?.click();
  },
  scope: () => tree(posts()),
  variants: { empty: () => tree([]) },
});
