/* Spustí všechny testy. Používej po každé změně save_klient nebo migrací:
 *     node tests/run.mjs
 */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const soubory = readdirSync(here).filter((f) => f.startsWith("test_") && f.endsWith(".mjs")).sort();

let selhalo = 0;
for (const f of soubory) {
  console.log(`\n${"=".repeat(60)}\n${f}\n${"=".repeat(60)}`);
  const r = spawnSync("node", [join(here, f)], { stdio: "inherit" });
  if (r.status !== 0) selhalo += 1;
}
console.log(`\n${"=".repeat(60)}`);
console.log(selhalo === 0
  ? `✓ Všech ${soubory.length} testů prošlo`
  : `✗ ${selhalo} z ${soubory.length} testů selhalo`);
process.exit(selhalo === 0 ? 0 : 1);
