import { bench, describe } from "vitest";
import { compileExpression, evaluateExpression } from "@jxsuite/runtime/expression";
import { buildStyleRules } from "@jxsuite/runtime/css";
import { readPath } from "@jxsuite/runtime/pointer";
import type { JxExpressionNode, JxStyle } from "@jxsuite/schema/types";
import type { JxScope } from "@jxsuite/runtime/types";

const ref = ($ref: string) => ({ $ref });

const rows = Array.from({ length: 500 }, (_, i) => ({
  active: i % 3 !== 0,
  price: i * 1.5,
  qty: i % 7,
}));
const state: JxScope = { rows, user: { profile: { address: { city: "Paris" } } } };

/** Sum of price * qty over the active rows: a filter feeding a reduce. */
const totalNode: JxExpressionNode = {
  initial: 0,
  operator: "reduce",
  target: {
    operator: "filter",
    target: ref("#/state/rows"),
    value: { operator: "===", target: ref("$map/item/active"), value: true },
  },
  value: {
    operator: "+",
    target: ref("$reduce/acc"),
    value: { operator: "*", target: ref("$map/item/price"), value: ref("$map/item/qty") },
  },
};

const mapNode: JxExpressionNode = {
  operator: "map",
  target: ref("#/state/rows"),
  value: { operator: "*", target: ref("$map/item/price"), value: 2 },
};

const style: JxStyle = {
  ":hover": { "@--md": { color: "blue" }, color: "red" },
  "@--md": { display: "grid", gridTemplateColumns: "repeat(3, 1fr)" },
  "@supports (display: grid)": { "@(min-width: 40rem)": { display: "grid" } },
  backgroundColor: "#6e0303",
  fontSize: "45px",
  li: { ":hover": { color: "blue" }, marginBlock: "0.5rem", paddingInline: "1rem" },
  "& > .card": { borderRadius: "8px", boxShadow: "0 1px 2px rgb(0 0 0 / 20%)" },
};
const mediaQueries = { "--md": "(min-width: 40rem)" };

describe("runtime/expression", () => {
  bench("evaluate filter+reduce over 500 rows", () => {
    void evaluateExpression(totalNode, state, null);
  });

  bench("evaluate map over 500 rows", () => {
    void evaluateExpression(mapNode, state, null);
  });

  bench("compile filter+reduce expression", () => {
    compileExpression(totalNode);
  });
});

describe("runtime/css", () => {
  bench("buildStyleRules nested style", () => {
    buildStyleRules(style, { mediaQueries, scope: ".s" });
  });
});

describe("runtime/pointer", () => {
  bench("readPath deep pointer x1000", () => {
    let city: unknown;
    for (let i = 0; i < 1000; i++) {
      city = readPath(state, "user/profile/address/city");
    }
    void city;
  });
});
