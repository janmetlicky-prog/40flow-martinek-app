/* Dva otevřené taby: souběžné úpravy.
 *
 * A) Různí klienti — obě změny musí projít.
 * B) Tentýž klient ze zastaralé verze — druhý zápis musí být odmítnut,
 *    aby kolegova změna nezmizela. Po přenačtení musí projít.
 *
 * Test používá VÝHRADNĚ vlastní klienty `test-…` a uklidí po sobě i při pádu
 * (sTestovacimiKlienty). Na ukázkové klienty týmu nikdy nesahá.
 *
 * Spouštění:  node tests/test_dva_taby.mjs
 */
import { prihlas, db, overit, vysledek, sTestovacimiKlienty } from "./lib.mjs";

const at = await prihlas("jan.metlicky@gmail.com");
const A = db(at), B = db(at);   // dvě nezávislé instance = dva taby
const [K1, K2, K3] = ["test-taby-a", "test-taby-b", "test-taby-c"];

async function nacti(d, id) {
  const k = (await d.get(`klienti?id=eq.${id}&select=*,oblasti(*)`))[0];
  return {
    id: k.id, upraveno: k.upraveno,
    oblasti: k.oblasti.map((o) => ({ klic: o.klic, stav: o.stav, faze: o.faze, poznamka: o.poznamka })),
  };
}

await sTestovacimiKlienty(A, [K1, K2, K3], async () => {
  for (const id of [K1, K2, K3]) {
    await A.save({
      id, jmeno: "Test", prijmeni: `Dva taby ${id.slice(-1)}`, stav: "aktivni",
      oblasti: [{ klic: "zivot", stav: "", faze: "", poznamka: "" }], upravil: "test",
    });
  }

  console.log("A) souběžná úprava různých klientů:");
  const a1 = await nacti(A, K1);
  const b1 = await nacti(B, K2);
  a1.oblasti.find((o) => o.klic === "zivot").poznamka = "zápis z tabu A";
  b1.oblasti.find((o) => o.klic === "zivot").poznamka = "zápis z tabu B";
  overit("tab A uložil", (await A.save({ ...a1, upravil: "tabA" })).ok);
  overit("tab B uložil", (await B.save({ ...b1, upravil: "tabB" })).ok);
  const po1 = await nacti(A, K1), po2 = await nacti(A, K2);
  overit("obě změny jsou v databázi",
    po1.oblasti.find((o) => o.klic === "zivot").poznamka === "zápis z tabu A" &&
    po2.oblasti.find((o) => o.klic === "zivot").poznamka === "zápis z tabu B");

  console.log("\nB) souběžná úprava téhož klienta:");
  const x1 = await nacti(A, K3);
  const x2 = await nacti(B, K3);          // oba drží stejné `upraveno`
  x1.oblasti.find((o) => o.klic === "zivot").poznamka = "první zápis";
  overit("první zápis prošel", (await A.save({ ...x1, upravil: "tabA" })).ok);
  x2.oblasti.find((o) => o.klic === "zivot").poznamka = "druhý zápis (zastaralý)";
  const r2 = await B.save({ ...x2, upravil: "tabB" });
  overit("zastaralý zápis odmítnut", !r2.ok && r2.telo.includes("KONFLIKT"));
  const fin = await nacti(A, K3);
  overit("v databázi zůstal první zápis", fin.oblasti.find((o) => o.klic === "zivot").poznamka === "první zápis");
  const x3 = await nacti(B, K3);
  x3.oblasti.find((o) => o.klic === "zivot").poznamka = "druhý zápis po přenačtení";
  overit("po přenačtení druhý zápis projde", (await B.save({ ...x3, upravil: "tabB" })).ok);
});

vysledek("Dva taby");
