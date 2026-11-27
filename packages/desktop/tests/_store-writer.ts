/** Fixture child for user-store.test.ts: patches one store from its own process. */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readStringStore, updateStore } from "../src/backend/user-store";

const [store, prefix, count, barrier] = process.argv.slice(2);
writeFileSync(join(barrier, `ready-${prefix}`), "");
while (!existsSync(join(barrier, "go"))) {
  await Bun.sleep(2);
}
for (let i = 0; i < Number(count); i += 1) {
  const key = `${prefix}-${i}`;
  await updateStore(store, readStringStore, (current) => ({ ...current, [key]: key }));
}
