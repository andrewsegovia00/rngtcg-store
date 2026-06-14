/* ============================================================================
   Server-side catalog validation for Cloudflare Pages Functions.
   Client prices are never trusted at checkout time.
   Keep this in sync with /catalog.js until Supabase becomes the catalog source.
   ============================================================================ */
export const CATEGORIES = [
  { id:"all",      label:"All Games",             short:"ALL",  accent:"var(--color-ink)" },
  { id:"pokemon",  label:"Pokémon",               short:"PKMN", accent:"var(--color-cat-pokemon)" },
  { id:"yugioh",   label:"Yu-Gi-Oh!",             short:"YGO",  accent:"var(--color-cat-yugioh)" },
  { id:"magic",    label:"Magic: The Gathering",  short:"MTG",  accent:"var(--color-cat-magic)" },
  { id:"lorcana",  label:"Lorcana",               short:"LOR",  accent:"var(--color-cat-lorcana)" },
  { id:"onepiece", label:"One Piece",             short:"OP",   accent:"var(--color-cat-onepiece)" },
  { id:"weiss",    label:"Weiss Schwarz",         short:"WS",   accent:"var(--color-cat-weiss)" },
];

export const LANGUAGES = [
  { id:"all",      label:"All Languages", short:"ALL" },
  { id:"english",  label:"English",       short:"EN" },
  { id:"japanese", label:"Japanese",      short:"JP" },
  { id:"chinese",  label:"Chinese",       short:"CN" },
];

const IMG = "/assets/products/";
const mk = (id,category,name,set,packPrice,boxPrice,o) => ({
  id, category, name, set, packPrice, boxPrice,
  language: o.language || "english", // "english" | "japanese" | "chinese"
  stock:o.stock, sale:o.sale||null, badge:o.badge||null, tone:o.tone, symbol:o.symbol,
  imageLabel:o.imageLabel||name, image:o.image||null, imagePack:o.imagePack||null
});

// Offline fallback only — Supabase /api/catalog is the source of truth.
export const PRODUCTS = [
  mk("pkm-jp-mega-symphonia","pokemon","Mega Symphonia","M1S",3.14,94.08,{stock:9,tone:"#f4b740",symbol:"◓",language:"japanese",image:IMG+"mega-symphonia-box.png",imagePack:IMG+"mega-symphonia-pack.png"}),
  mk("pkm-jp-mega-brave","pokemon","Mega Brave","M1L",3.14,94.08,{stock:26,tone:"#e0552b",symbol:"◓",language:"japanese",image:IMG+"mega-brave-box.png",imagePack:IMG+"mega-brave-pack.png"}),
  mk("pkm-jp-lost-abyss","pokemon","Lost Abyss","S11",6.85,null,{stock:11,tone:"#5b6cae",symbol:"◓",language:"japanese",image:IMG+"lost-abyss-pack.png",imagePack:IMG+"lost-abyss-pack.png"}),
  mk("pkm-jp-night-wanderer","pokemon","Night Wanderer","SV6a",null,39.54,{stock:1,tone:"#3a2e63",symbol:"◓",language:"japanese",image:IMG+"night-wanderer-box.png"}),
  mk("pkm-jp-paradise-dragona","pokemon","Paradise Dragona","SV7a",1.51,45.23,{stock:28,tone:"#2a8f9e",symbol:"◓",language:"japanese",image:IMG+"paradise-dragona-box.png",imagePack:IMG+"paradise-dragona-pack.png"}),
  mk("pkm-jp-eevee-heroes","pokemon","Eevee Heroes","S6a",19.52,585.66,{stock:13,tone:"#caa45b",symbol:"◓",language:"japanese",image:IMG+"eevee-heroes-box.png",imagePack:IMG+"eevee-heroes-pack.png"}),

  mk("weiss-jp-hololive-v2","weiss","Hololive Vol. 2","HOL2",5.64,90.30,{stock:11,tone:"#5ac8e8",symbol:"♪",language:"japanese",image:IMG+"hololive-v2-box.png",imagePack:IMG+"hololive-v2-pack.png"}),

  mk("ygo-jp-qc-pride","yugioh","QC: PRIDE (blue)","QCPR",3.19,47.87,{stock:13,tone:"#3f6df0",symbol:"◈",language:"japanese",image:IMG+"qc-pride-box.png",imagePack:IMG+"qc-pride-pack.png"}),
  mk("ygo-jp-qc-edition","yugioh","QC Edition (red)","QCED",4.02,60.36,{stock:9,tone:"#d23b3b",symbol:"◈",language:"japanese"}),
  mk("ygo-jp-qc-unity","yugioh","QC: UNITY (purple)","QCUN",4.36,null,{stock:10,tone:"#7c3aed",symbol:"◈",language:"japanese",image:IMG+"qc-unity-pack.png",imagePack:IMG+"qc-unity-pack.png"}),

  mk("op-jp-prb01","onepiece","PRB01","PRB01",4.26,42.56,{stock:16,tone:"#c94b9b",symbol:"☠",language:"japanese",image:IMG+"prb01-box.png",imagePack:IMG+"prb01-pack.png"}),
  mk("op-jp-eb01","onepiece","EB01","EB01",1.88,45.23,{stock:19,tone:"#2a6f8e",symbol:"☠",language:"japanese",image:IMG+"eb01-box.png",imagePack:IMG+"eb01-pack.png"}),
  mk("op-jp-op05","onepiece","OP-05","OP05",4.52,108.50,{stock:19,tone:"#1d3557",symbol:"☠",language:"japanese"}),
  mk("op-jp-op09","onepiece","OP-09","OP09",2.59,62.10,{stock:12,tone:"#2a8f64",symbol:"☠",language:"japanese"}),
  mk("op-jp-op01","onepiece","OP-01","OP01",4.30,103.23,{stock:9,tone:"#9a2b1f",symbol:"☠",language:"japanese"}),
  mk("op-jp-op07","onepiece","OP-07","OP07",2.09,50.09,{stock:6,tone:"#3aa0a8",symbol:"☠",language:"japanese",image:IMG+"op07-box.png",imagePack:IMG+"op07-pack.png"}),
  mk("op-jp-op08","onepiece","OP-08","OP08",1.91,45.92,{stock:21,tone:"#6a4ea3",symbol:"☠",language:"japanese",image:IMG+"op08-box.png",imagePack:IMG+"op08-pack.png"}),

  mk("pkm-en-phantasmal-flames","pokemon","Phantasmal Flames","PHF",null,309.59,{stock:2,tone:"#e0552b",symbol:"✦",language:"english"}),

  mk("test-01","pokemon","TEST — Do Not Ship","TEST",0.5,0.5,{stock:100,badge:"TEST",tone:"#9aa0a6",symbol:"⚙",language:"english"}),
];

export const productById = id => PRODUCTS.find(p => p.id === id);
export const categoryById = id => CATEGORIES.find(c => c.id === id);
export const languageById = id => LANGUAGES.find(l => l.id === id);
export const categoryShort = id => (categoryById(id) || {short:String(id).slice(0,3).toUpperCase()}).short;
export const languageShort = id => (languageById(id) || {short:String(id).slice(0,2).toUpperCase()}).short;
export const unitPrice = (p, fmt) => {
  const base = fmt === "box" ? p.boxPrice : p.packPrice;
  return p.sale ? +(base * (1 - p.sale/100)).toFixed(2) : base;
};
export const toCents = dollars => Math.round(Number(dollars || 0) * 100);
