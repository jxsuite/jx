/**
 * Mapped-array micro-benchmark: keyed reconciliation against index-keyed rebuilds.
 *
 * Run with `bun packages/runtime/tests/_bench_lists.ts [rows]`.
 *
 * Not a test. It renders a list through `mount()` under happy-dom and times create, append,
 * reverse, shuffle and remove for a keyed and an unkeyed array, printing milliseconds per
 * operation. The numbers are happy-dom's, not a browser's; they compare the two modes against each
 * other, which is the question the reconciler was written to answer.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { reactive } from "@vue/reactivity";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

const { mount } = await import("../src/runtime");

const ROWS = Number(process.argv[2] ?? 1000);

interface Row {
  id: number;
  title: string;
}

const makeRows = (n: number, from = 0): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: from + i, title: `row ${from + i}` }));

const tick = () =>
  new Promise((r) => {
    setTimeout(r, 0);
  });

async function timed(label: string, fn: () => void | Promise<void>): Promise<number> {
  const start = Bun.nanoseconds();
  await fn();
  await tick();
  const ms = (Bun.nanoseconds() - start) / 1e6;
  console.log(`  ${label.padEnd(18)} ${ms.toFixed(2).padStart(9)} ms`);
  return ms;
}

async function run(keyed: boolean): Promise<void> {
  console.log(keyed ? "keyed ($map/item/id)" : "unkeyed (index)");
  const rows = reactive(makeRows(ROWS));
  const host = document.createElement("div");
  document.body.append(host);
  await timed("create", async () => {
    await mount(
      {
        tagName: "ul",
        children: [
          {
            $prototype: "Array",
            items: { $ref: "#/state/rows" },
            ...(keyed ? { key: { $ref: "$map/item/id" } } : {}),
            map: { tagName: "li", textContent: "${$map.index}:${$map.item.title}" },
          },
        ],
      },
      host,
      { scope: { rows } },
    );
  });
  await timed("append 100", () => {
    rows.push(...makeRows(100, ROWS));
  });
  await timed("reverse", () => {
    rows.reverse();
  });
  await timed("shuffle", () => {
    for (let i = rows.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rows[i], rows[j]] = [rows[j]!, rows[i]!];
    }
  });
  await timed("remove 100", () => {
    rows.splice(0, 100);
  });
  await timed("edit one title", () => {
    rows[0]!.title = "edited";
  });
  host.remove();
}

console.log(`${ROWS} rows`);
await run(true);
await run(false);
