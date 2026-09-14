/* Dva otevřené taby: souběžné úpravy.
 *
 * A) Různí klienti — obě změny musí projít.
 * B) Tentýž klient ze zastaralé verze — druhý zápis musí být odmítnut,
 *    aby kolegova změna nezmizela. Po přenačtení musí projít.
 *
 * Spouštění:  node tests/test_dva_taby.mjs
 */
import { prihlas, db, overit, vysledek } from "./lib.mjs";

const at = await prihlas("jan.metlicky@gmail.com");
const A = db(at), B = db(at);   // dvě nezávislé instance = dva taby

async function nacti(d, id) {
  const k = (await d.get(`klienti?id=eq.${id}&select=*,oblasti(*)`))[0];
  return {
    id: k.id, upraveno: k.upraveno,
    oblasti: k.oblasti.map((o) => ({
      klic: o.klic, stav: o.stav, faze: o.faze, poznamka: o.poznamka,
    })),
  };
}

// --- A) různí klienti --------------------------------------------------------
console.log("A) souběžná úprava různých klientů:");
const a1 = await nacti(A, "t0003");
const b1 = await nacti(B, "t0005");
a1.oblasti.find((o) => o.klic === "zivot").poznamka = "zápis z tabu A";
b1.oblasti.find((o) => o.klic === "zivot").poznamka = "zápis z tabu B";
const ra = await A.save({ ...a1, upravil: "tabA" });
const rb = await B.save({ ...b1, upravil: "tabB" });
overit("tab A uložil", ra.ok);
overit("tab B uložil", rb.ok);

const po3 = await nacti(A, "t0003");
const po5 = await nacti(A, "t0005");
overit("obě změny jsou v databázi",
  po3.oblasti.find((o) => o.klic === "zivot").poznamka === "zápis z tabu A" &&
  po5.oblasti.find((o) => o.klic === "zivot").poznamka === "zápis z tabu B");

// --- B) tentýž klient, druhý tab má zastaralou verzi ------------------------
console.log("\nB) souběžná úprava téhož klienta:");
const x1 = await nacti(A, "t0004");
const x2 = await nacti(B, "t0004");          // oba drží stejné `upraveno`
x1.oblasti.find((o) => o.klic === "zivot").poznamka = "první zápis";
const r1 = await A.save({ ...x1, upravil: "tabA" });
overit("první zápis prošel", r1.ok);

x2.oblasti.find((o) => o.klic === "zivot").poznamka = "druhý zápis (zastaralý)";
const r2 = await B.save({ ...x2, upravil: "tabB" });
overit("zastaralý zápis odmítnut", !r2.ok && r2.telo.includes("KONFLIKT"));

const fin = await nacti(A, "t0004");
overit("v databázi zůstal první zápis",
  fin.oblasti.find((o) => o.klic === "zivot").poznamka === "první zápis");

const x3 = await nacti(B, "t0004");
x3.oblasti.find((o) => o.klic === "zivot").poznamka = "druhý zápis po přenačtení";
overit("po přenačtení druhý zápis projde", (await B.save({ ...x3, upravil: "tabB" })).ok);

vysledek("Dva taby");
