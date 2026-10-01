/* Kontrola souboru v prohlížeči — stejná pravidla jako na serveru
   (supabase/functions/_shared/soubor.ts). Prohlížeč jen ušetří zbytečný
   upload; rozhoduje server. */
"use strict";

const SOUBOR_MAX_MB = 15;

async function rozpoznejTypSouboru(file) {
  const b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const eq = (off, bytes) => bytes.every((x, i) => b[off + i] === x);
  if (b.length >= 5 && eq(0, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: "application/pdf", pripona: "pdf" };
  if (b.length >= 3 && eq(0, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", pripona: "jpg" };
  if (b.length >= 8 && eq(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", pripona: "png" };
  if (b.length >= 12 && eq(4, [0x66, 0x74, 0x79, 0x70])) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heif"].includes(brand)) return { mime: "image/heic", pripona: "heic" };
  }
  return null;
}

/** Vrátí "" když je soubor v pořádku, jinak českou hlášku. */
async function overSoubor(file) {
  if (file.size > SOUBOR_MAX_MB * 1024 * 1024) return `${file.name}: soubor je větší než ${SOUBOR_MAX_MB} MB.`;
  if (file.size === 0) return `${file.name}: soubor je prázdný.`;
  if (!(await rozpoznejTypSouboru(file))) return `${file.name}: povolené jsou jen PDF, JPG, PNG a HEIC (posuzuje se obsah souboru, ne přípona).`;
  return "";
}

function bezpecnyNazevSouboru(puvodni, pripona) {
  const bez = puvodni.replace(/\.[^.]+$/, "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "soubor";
  return `${bez}.${pripona}`;
}

/**
 * Fotky z mobilu mají 5–8 MB; při retenci 10 let je to zbytečná kapacita.
 * Obrázek (JPG/PNG/HEIC) nad ~1,5 MB → delší strana max 2000 px, JPG 85 %.
 * PDF a malé soubory beze změny. Když prohlížeč formát neumí dekódovat
 * (HEIC mimo Safari), vrátí se původní soubor — kontrola typu proběhne až potom.
 */
async function zkomprimujObrazek(file, { prahMB = 1.5, maxPx = 2000, kvalita = 0.85 } = {}) {
  if (file.size <= prahMB * 1024 * 1024) return file;
  const typ = await rozpoznejTypSouboru(file);
  if (!typ || typ.mime === "application/pdf") return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
    bmp.close && bmp.close();
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", kvalita));
    if (!blob || blob.size >= file.size) return file;
    const nazev = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], nazev, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
}
