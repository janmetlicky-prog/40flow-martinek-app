// Kontrola typu souboru z obsahu (magic bytes), ne z přípony ani Content-Type.
// Stejná logika běží i v prohlížeči (js/soubor.js) — tady je rozhodující.

export const MAX_MB = 15;
export const MAX_BYTES = MAX_MB * 1024 * 1024;

export type Typ = { mime: string; pripona: string };

/** Vrátí rozpoznaný typ, nebo null = nepovolený / neznámý obsah. */
export function rozpoznejTyp(hlavicka: Uint8Array): Typ | null {
  const b = hlavicka;
  const eq = (off: number, bytes: number[]) => bytes.every((x, i) => b[off + i] === x);
  if (b.length >= 5 && eq(0, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: "application/pdf", pripona: "pdf" };   // %PDF-
  if (b.length >= 3 && eq(0, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", pripona: "jpg" };
  if (b.length >= 8 && eq(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", pripona: "png" };
  // HEIC/HEIF: ISO BMFF — na offsetu 4 "ftyp", pak brand
  if (b.length >= 12 && eq(4, [0x66, 0x74, 0x79, 0x70])) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heif"].includes(brand)) return { mime: "image/heic", pripona: "heic" };
  }
  return null;
}

/** Název do cesty v bucketu: jen bezpečné znaky, bez diakritiky, s příponou podle obsahu. */
export function bezpecnyNazev(puvodni: string, pripona: string): string {
  const bez = puvodni.replace(/\.[^.]+$/, "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "soubor";
  return `${bez}.${pripona}`;
}
