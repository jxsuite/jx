/** The module report: what Studio says about a document's `$src` entries when it is saved. */

import "./harness";
import { afterEach, describe, expect, test } from "bun:test";
import { MODULE_PROBLEM_SOURCE, reportModuleAdvice } from "../src/services/module-report";
import { problems, resetNotifications } from "../src/services/notify";
import type { JxDocument } from "@jxsuite/schema/types";

/** Everything this source has filed. */
function filed() {
  return problems.filter((record) => record.source === MODULE_PROBLEM_SOURCE);
}

const TWO_FILES: JxDocument = {
  state: {
    bump: { $prototype: "Function", $src: "./counter.js" },
    reset: { $prototype: "Function", $src: "./counter.js" },
  },
  tagName: "my-counter",
};

afterEach(() => {
  resetNotifications();
});

describe("reportModuleAdvice (spec.md §23.2)", () => {
  test("a document naming a package, the kit and its own script files nothing", () => {
    const filedCount = reportModuleAdvice({
      $script: { client: "export const bump = () => {}" },
      state: {
        bump: { $prototype: "Function", $src: "#client" },
        debounce: { $prototype: "Function", $src: "npm:lodash-es" },
        open: { $prototype: "Function", $src: "jx-ui:/behaviors/dialog.ts" },
      },
      tagName: "my-counter",
    });
    expect(filedCount).toBe(0);
    expect(filed()).toHaveLength(0);
  });

  test("a relative $src is advice in Problems: info, on the file, and with no button", () => {
    expect(reportModuleAdvice(TWO_FILES, "components/counter.jxn")).toBe(2);
    const records = filed();
    // Two entries importing one file are two records: a key of the rule alone would keep one.
    expect(records.map((record) => record.key)).toEqual([
      "module.relative-src.state/bump",
      "module.relative-src.state/reset",
    ]);
    const [first] = records;
    expect(first?.severity).toBe("info");
    expect(first?.tier).toBe("problem");
    expect(first?.path).toBe("components/counter.jxn");
    expect(first?.message).toBe(
      '"bump" imports ./counter.js, which the document could carry as its own script',
    );
    expect(first?.detail).toContain("keeps working");
    expect(first?.action).toBeUndefined();
  });

  test("a document with no file is reported without one", () => {
    reportModuleAdvice(TWO_FILES);
    expect(filed()[0]?.path).toBeUndefined();
  });

  test("a second run replaces the first, so advice taken is advice gone", () => {
    reportModuleAdvice(TWO_FILES, "components/counter.jxn");
    expect(reportModuleAdvice({ tagName: "my-counter" }, "components/counter.jxn")).toBe(0);
    expect(filed()).toHaveLength(0);
  });

  test("a $lazy entry in a script that loads with the page is told it defers nothing", () => {
    reportModuleAdvice({
      $script: { client: "export const bump = () => {}; export const chart = () => {}" },
      state: {
        bump: { $prototype: "Function", $src: "#client" },
        chart: { $lazy: true, $prototype: "Function", $src: "#client" },
      },
      tagName: "my-chart",
    });
    expect(filed().map((record) => record.key)).toEqual(["module.lazy-shares-script.state/chart"]);
  });
});
