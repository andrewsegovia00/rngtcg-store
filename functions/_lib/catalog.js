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
];

export const LANGUAGES = [
  { id:"all",      label:"All Languages", short:"ALL" },
  { id:"english",  label:"English",       short:"EN" },
  { id:"japanese", label:"Japanese",      short:"JP" },
  { id:"chinese",  label:"Chinese",       short:"CN" },
];

const mk = (id,category,name,set,packPrice,boxPrice,o) => ({
  id, category, name, set, packPrice, boxPrice,
  language: o.language || "english", // "english" | "japanese" | "chinese"
  stock:o.stock, sale:o.sale||null, badge:o.badge||null, tone:o.tone, symbol:o.symbol,
  imageLabel:o.imageLabel||name
});

export const PRODUCTS = [
  mk("pkm-01","pokemon","Surging Sparks","SV08",6,144,{stock:24,badge:"HOT",tone:"#f5b13d",symbol:"◐",language:"english"}),
  mk("pkm-02","pokemon","Stellar Crown","SV07",5,120,{stock:12,sale:15,tone:"#7ec0ff",symbol:"✦",language:"english"}),
  mk("pkm-03","pokemon","Twilight Masquerade","SV06",5,120,{stock:6,tone:"#7b3aa8",symbol:"◑",language:"english"}),
  mk("pkm-04","pokemon","Temporal Forces","SV05",5,120,{stock:31,badge:"NEW",tone:"#3aa0a8",symbol:"◯",language:"english"}),
  mk("pkm-05","pokemon","Paldean Fates","SV4a",7,168,{stock:4,tone:"#ffd166",symbol:"★",language:"english"}),
  mk("pkm-06","pokemon","Paradox Rift","SV04",5,120,{stock:0,tone:"#c83e6b",symbol:"◇",language:"english"}),
  mk("pkm-07","pokemon","151","MEW",9,216,{stock:8,badge:"HOT",tone:"#e8714b",symbol:"▦",language:"english"}),
  mk("pkm-08","pokemon","Crown Zenith","SWSH",6,144,{stock:2,sale:25,tone:"#caa45b",symbol:"♛",language:"english"}),
  mk("pkm-jp-01","pokemon","Scarlet & Violet Base Set","SV1",3.49,89.99,{stock:20,badge:"JP",tone:"#fff8b7",symbol:"ポ",language:"japanese",imageLabel:"Pokemon SV Box JP"}),
  mk("pkm-jp-02","pokemon","Twilight Masquerade JP","SV06",3.49,96,{stock:150,badge:"JP",tone:"#fff8b7",symbol:"月",language:"japanese",imageLabel:"Pokemon TM Pack JP"}),
  mk("pkm-cn-01","pokemon","Gem Pack Vol. 1","CN01",4.25,102,{stock:36,badge:"CN",tone:"#f9d0d0",symbol:"宝",language:"chinese",imageLabel:"Pokemon Gem Pack CN"}),

  mk("mtg-01","magic","Bloomburrow","BLB",6,126,{stock:18,badge:"HOT",tone:"#7fb069",symbol:"❀",language:"english"}),
  mk("mtg-02","magic","Outlaws of Thunder","OTJ",6,126,{stock:9,tone:"#c0392b",symbol:"✶",language:"english"}),
  mk("mtg-03","magic","Murders at Karlov","MKM",5,108,{stock:14,tone:"#2a6f8e",symbol:"◈",language:"english"}),
  mk("mtg-04","magic","Lost Caverns","LCI",5,108,{stock:3,sale:20,tone:"#caa45b",symbol:"▲",language:"english"}),
  mk("mtg-05","magic","Wilds of Eldraine","WOE",5,108,{stock:22,tone:"#6a4ea3",symbol:"♔",language:"english"}),
  mk("mtg-06","magic","Duskmourn","DSK",6,126,{stock:7,badge:"NEW",tone:"#3d2a4d",symbol:"◉",language:"english"}),
  mk("mtg-07","magic","Foundations","FDN",7,144,{stock:15,badge:"PRE",tone:"#1d3557",symbol:"✦",language:"english"}),

  mk("ygo-01","yugioh","Rage of the Abyss","ROTA",4,96,{stock:11,badge:"NEW",tone:"#1a2b4a",symbol:"◊",language:"english"}),
  mk("ygo-02","yugioh","Supreme Darkness","SUDA",4,96,{stock:6,tone:"#3d1a4a",symbol:"✧",language:"english"}),
  mk("ygo-03","yugioh","Infinite Forbidden","INFO",5,110,{stock:19,badge:"HOT",tone:"#9a2b1f",symbol:"◐",language:"english"}),
  mk("ygo-04","yugioh","Phantom Nightmare","PHNI",4,96,{stock:4,sale:10,tone:"#2a6f8e",symbol:"▼",language:"english"}),
  mk("ygo-jp-01","yugioh","Alliance Insight JP","ALIN",3.25,78,{stock:32,badge:"JP",tone:"#fff8b7",symbol:"遊",language:"japanese",imageLabel:"Yu-Gi-Oh! ALIN JP"}),
  mk("ygo-cn-01","yugioh","Duelist Nexus CN","DUNE",3.5,84,{stock:18,badge:"CN",tone:"#f9d0d0",symbol:"龙",language:"chinese",imageLabel:"Yu-Gi-Oh! DUNE CN"}),

  mk("lor-01","lorcana","Azurite Sea","CH4",6,144,{stock:16,badge:"NEW",tone:"#2a6f8e",symbol:"◈",language:"english"}),
  mk("lor-02","lorcana","Shimmering Skies","CH5",6,144,{stock:8,tone:"#a8c8e8",symbol:"✦",language:"english"}),
  mk("lor-03","lorcana","Ursula's Return","CH3",5,120,{stock:11,tone:"#6a4ea3",symbol:"♛",language:"english"}),
  mk("lor-04","lorcana","Rise of the Floodborn","CH2",5,120,{stock:22,sale:15,tone:"#1f5d3a",symbol:"❀",language:"english"}),

  mk("op-01","onepiece","Romance Dawn","OP01",4,96,{stock:9,badge:"HOT",tone:"#9a2b1f",symbol:"☠",language:"english"}),
  mk("op-02","onepiece","Paramount War","OP02",4,96,{stock:13,tone:"#1d3557",symbol:"⚓",language:"english"}),
  mk("op-03","onepiece","Pillars of Strength","OP03",4,96,{stock:7,tone:"#2a6f8e",symbol:"◉",language:"english"}),
  mk("op-04","onepiece","Kingdoms of Intrigue","OP04",4,96,{stock:18,tone:"#6a4ea3",symbol:"♛",language:"english"}),
  mk("op-jp-01","onepiece","Two Legends JP","OP08",5,118,{stock:14,badge:"JP",tone:"#fff8b7",symbol:"海",language:"japanese",imageLabel:"One Piece OP08 JP"}),

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
