/**
 * Web-Standards Live TV Gateway (`maxTV` Stalker + optional `StarShare` Xtream) for TanStack Start / Cloudflare Workers.
 *
 * Uses only Web-standard `fetch`, `ReadableStream`, `TextEncoder`/`TextDecoder`, and `crypto.subtle`
 * (zero `node:*` imports) so `vite build` with Lovable's Nitro Cloudflare target succeeds cleanly.
 */

export interface LiveChannelItem {
  id: string;
  rawId: string;
  source: "maxtv" | "starshare";
  name: string;
  category: string;
  logo: string;
  cmd?: string;
}

export interface LiveChannelDto {
  id: string;
  source: "maxtv" | "starshare";
  name: string;
  category: string;
  rawCategory: string;
  logo: string;
  embedUrl: string;
  iframeCode: string;
  streamUrl: string;
}

const MAG_USER_AGENT =
  "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 4 rev: 2110 Safari/533.3";
const MAG_DEVICE_UA = "Model: MAG254; Link: WiFi";
const XTREAM_USER_AGENT = "IPTVSmartersPlayer";
const CATALOGUE_TTL_MS = 15 * 60 * 1000;

const PREVIEW_SEED_CHANNELS: LiveChannelItem[] = [
  { id: "st:1001", rawId: "1001", source: "maxtv", name: "Star Sports 1 Hindi HD", category: "SPORTS | CRICKET", logo: "", cmd: "seed://1001" },
  { id: "st:1002", rawId: "1002", source: "maxtv", name: "Star Sports 2 HD", category: "SPORTS | CRICKET", logo: "", cmd: "seed://1002" },
  { id: "st:1003", rawId: "1003", source: "maxtv", name: "Sports18 1 HD", category: "SPORTS | INDIA", logo: "", cmd: "seed://1003" },
  { id: "st:1004", rawId: "1004", source: "maxtv", name: "Sony Sports Ten 1 HD", category: "SPORTS | CRICKET", logo: "", cmd: "seed://1004" },
  { id: "st:1005", rawId: "1005", source: "maxtv", name: "Sony Sports Ten 3 Hindi HD", category: "SPORTS | CRICKET", logo: "", cmd: "seed://1005" },
  { id: "st:1006", rawId: "1006", source: "maxtv", name: "Willow Cricket HD", category: "SPORTS | CRICKET", logo: "", cmd: "seed://1006" },
  { id: "st:1010", rawId: "1010", source: "maxtv", name: "Star Plus HD", category: "INDIA | ENTERTAINMENT", logo: "", cmd: "seed://1010" },
  { id: "st:1011", rawId: "1011", source: "maxtv", name: "Sony SET HD", category: "INDIA | ENTERTAINMENT", logo: "", cmd: "seed://1011" },
  { id: "st:1012", rawId: "1012", source: "maxtv", name: "Sony SAB HD", category: "INDIA | ENTERTAINMENT", logo: "", cmd: "seed://1012" },
  { id: "st:1013", rawId: "1013", source: "maxtv", name: "Colors HD", category: "INDIA | ENTERTAINMENT", logo: "", cmd: "seed://1013" },
  { id: "st:1014", rawId: "1014", source: "maxtv", name: "Zee TV HD", category: "INDIA | ENTERTAINMENT", logo: "", cmd: "seed://1014" },
  { id: "st:1020", rawId: "1020", source: "maxtv", name: "Sony Max HD", category: "INDIA | HINDI MOVIES", logo: "", cmd: "seed://1020" },
  { id: "st:1021", rawId: "1021", source: "maxtv", name: "Star Gold HD", category: "INDIA | HINDI MOVIES", logo: "", cmd: "seed://1021" },
  { id: "st:1022", rawId: "1022", source: "maxtv", name: "Zee Cinema HD", category: "INDIA | HINDI MOVIES", logo: "", cmd: "seed://1022" },
  { id: "st:1023", rawId: "1023", source: "maxtv", name: "Colors Cineplex HD", category: "INDIA | HINDI MOVIES", logo: "", cmd: "seed://1023" },
  { id: "st:1030", rawId: "1030", source: "maxtv", name: "Aaj Tak HD", category: "INDIA | NEWS", logo: "", cmd: "seed://1030" },
  { id: "st:1031", rawId: "1031", source: "maxtv", name: "NDTV India", category: "INDIA | NEWS", logo: "", cmd: "seed://1031" },
  { id: "st:1032", rawId: "1032", source: "maxtv", name: "India TV HD", category: "INDIA | NEWS", logo: "", cmd: "seed://1032" },
  { id: "st:1040", rawId: "1040", source: "maxtv", name: "Discovery Channel India HD", category: "INDIA | DOCUMENTARY", logo: "", cmd: "seed://1040" },
  { id: "st:1041", rawId: "1041", source: "maxtv", name: "National Geographic HD India", category: "INDIA | DOCUMENTARY", logo: "", cmd: "seed://1041" },
  { id: "st:1050", rawId: "1050", source: "maxtv", name: "Cartoon Network India", category: "INDIA | KIDS", logo: "", cmd: "seed://1050" },
  { id: "st:1051", rawId: "1051", source: "maxtv", name: "Hungama TV", category: "INDIA | KIDS", logo: "", cmd: "seed://1051" },
  { id: "st:1060", rawId: "1060", source: "maxtv", name: "9XM", category: "INDIA | MUSIC", logo: "", cmd: "seed://1060" },
  { id: "st:1061", rawId: "1061", source: "maxtv", name: "MTV Beats HD", category: "INDIA | MUSIC", logo: "", cmd: "seed://1061" },
];

type GatewayConfig = {
  maxtvPortal: string;
  maxtvMac: string;
  maxtvSerial: string;
  maxtvDeviceId: string;
  starshareServer: string;
  starshareFallback: string;
  starshareUser: string;
  starsharePass: string;
  proxySecret: string;
};

function readEnv(env: unknown, key: string, fallback = ""): string {
  const rec = env && typeof env === "object" ? (env as Record<string, unknown>) : {};
  if (typeof rec[key] === "string" && (rec[key] as string).trim()) return (rec[key] as string).trim();
  const proc = typeof globalThis !== "undefined" && "process" in globalThis
    ? (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    : undefined;
  const fromProc = proc?.[key]?.trim();
  return fromProc || fallback;
}

function getConfig(env: unknown): GatewayConfig {
  return {
    maxtvPortal: readEnv(env, "MAXTV_PORTAL", "http://new.maxtv.be/stalker_portal/c/"),
    maxtvMac: readEnv(env, "MAXTV_MAC", "00:1A:79:EE:03:9F"),
    maxtvSerial: readEnv(env, "MAXTV_SERIAL", "92180365D21FE"),
    maxtvDeviceId: readEnv(
      env,
      "MAXTV_DEVICE_ID",
      "3610DEAFB556781F84CBC8A6AF876A8F20637668862B28DEECFACE00D67A6070",
    ),
    starshareServer: readEnv(env, "STARSHARE_SERVER", "http://livebox.pro:8080"),
    starshareFallback: readEnv(env, "STARSHARE_FALLBACK", "http://starshare.fans:8080"),
    starshareUser: readEnv(env, "STARSHARE_USER", ""),
    starsharePass: readEnv(env, "STARSHARE_PASS", ""),
    proxySecret: readEnv(env, "LIVE_PROXY_SECRET", "streamr-maxtv-live-gateway-v1"),
  };
}

// ---------- Indian Hindi + Sports/Cricket + Dual-Audio Filter ----------

const ADULT_RE = /\b(?:XXX|ADULT|ADULTS|FOR\s+ADULTS|18\+|PORN|PLAYBOY|BRAZZERS|EROTIC|ONLYFANS)\b/i;
const HINDI_EXPLICIT_RE = /\b(?:HINDI|BOLLYWOOD|HIN\s*DUB|HINDI\s*DUB(?:BED)?|DUAL\s*AUDIO|DESI|BIGG\s*BOSS)\b/i;
const INDIA_TAG_RE =
  /(?:^|[|\[(\{\s:\-])(?:IN|IND|INDIA|INDIAN|BHARAT|HINDUSTAN|TATA\s*PLAY|TATA\s*SKY|JIO(?:\s*TV|\s*CINEMA|\s*HOTSTAR)?|AIRTEL|DISH\s*TV|D2H|DOORDARSHAN|HOTSTAR|ZEE5|SONYLIV|SONY\s*LIV|MX\s*PLAYER|TVF)(?:$|[|\])\}\s:\-])/i;
const CRICKET_RE =
  /\b(?:CRICKET|IPL|BCCI|ICC|WPL|ASIA\s*CUP|WILLOW|ASTRO\s*CRICKET|STAR\s*SPORTS|SPORTS\s*18|SPORTS18|SONY\s*(?:SPORTS|TEN)|TEN\s*SPORTS|DD\s*SPORTS|FANCODE|FAN\s*CODE)\b/i;
const INDIAN_SPORTS_RE = /\b(?:PRO\s*KABADDI|ISL|INDIAN\s*SUPER\s*LEAGUE|EUROSPORT\s*INDIA)\b/i;
const REGIONAL_NON_HINDI_RE =
  /\b(?:TAMIL|TAMIZH|TELUGU|TELGU|MALAYALAM|MALYALAM|KERALAM|KANNADA|MARATHI|BENGALI|BANGLA|PUNJABI|GUJARATI|GUJRATI|ODIA|ORIYA|ASSAMESE|ASSAM|BHOJPURI|URDU|NEPALI|SINHALA|SUN\s*TV|SUN\s*MUSIC|KTV|ADITHYA|UDAYA|SURYA\s*TV|GEMINI|STAR\s*(?:MAA|VIJAY|JALSHA|SUVARNA|PRAVAH|KIRAN)|ASIANET|MAZHAVIL|KAIRALI|MANORAMA|KALAIGNAR|POLIMER|THANTHI|JAYA\s*TV|ZEE\s*(?:TAMIL|TELUGU|KANNADA|KERALAM|MARATHI|BANGLA|PUNJABI|SARTHAK|TALKIES|PICCHAR)|COLORS\s*(?:TAMIL|KANNADA|MARATHI|BANGLA|GUJARATI|ODIA)|SONY\s*(?:MARATHI|AATH)|PTC\s*PUNJABI)\b/i;
const FOREIGN_STRICT_RE =
  /(?:^|[|\[(\{\s:\-])(?:US|USA|UK|UNITED\s*KINGDOM|CA|CANADA|AU|AUSTRALIA|NZ|PK|PAK|PAKISTAN|BD|BANGLADESH|AF|AFGHANISTAN|AR|ARA|ARAB|ARABIC|AE|UAE|SAUDI|QATAR|OSN|MBC|TR|TURKEY|IR|IRAN|FR|FRANCE|DE|GERMANY|ES|SPAIN|LATAM|PT|PORTUGAL|BR|BRAZIL|IT|ITALY|NL|NETHERLANDS|PL|POLAND|RU|RUSSIA|RO|ROMANIA|GR|GREECE|AL|ALBANIA|EX[-\s]*YU|AFRICA|DSTV|PH|MY|SG|ID|TH|VN|CN|HK|TW|JP|KR|CARIBBEAN|NFL|NBA|NHL|MLB)(?:$|[|\])\}\s:\-])/i;
const FOREIGN_CHANNEL_PREFIX_RE =
  /^(?:US|USA|UK|CA|AU|NZ|PK|PAK|BD|AF|AR|AE|TR|IR|FR|DE|ES|PT|BR|IT|NL|PL|RU|RO|GR|AL|ZA|PH|MY|ID|TH|VN|CN|HK|JP|KR)\b\s*[:|\-]/i;
const INDIAN_BROADCASTER_RE =
  /\b(?:STAR\s*(?:PLUS|BHARAT|UTSAV|GOLD|MOVIES|WORLD)|SONY\s*(?:SET|SAB|MAX|PIX|PAL|WAH|YAY|BBC\s*EARTH)|SET\s*(?:INDIA|HD)|SAB\s*(?:TV|HD)|ZEE\s*(?:TV|CINEMA|BOLLYWOOD|ACTION|CLASSIC|ANMOL|CAFE|ZEST|NEWS|BUSINESS|BHARAT)|COLORS(?:\s*(?:HD|SD|TV|INFINITY|CINEPLEX|RISHTEY))?|&(?:\s*TV|\s*PICTURES|\s*FLICKS|\s*PRIVE)|AND\s*(?:TV|PICTURES|FLICKS)|DANGAL|SHEMAROO|GOLDMINES|B4U\s*(?:MOVIES|MUSIC|KADAK)|UTV\s*(?:MOVIES|ACTION|BINDASS)|BINDASS|EPIC\s*TV|AAJ\s*TAK|INDIA\s*TODAY|NDTV|INDIA\s*TV|ABP\s*NEWS|NEWS\s*18\s*INDIA|NEWS\s*24|REPUBLIC\s*(?:TV|BHARAT)|TIMES\s*NOW|MIRROR\s*NOW|CNBC\s*(?:AWAAZ|TV18)|WION|DD\s*(?:NATIONAL|NEWS|INDIA|BHARATI|KISAN|SPORTS)|SANSAD\s*TV|TV9\s*BHARATVARSH|DISCOVERY|ANIMAL\s*PLANET|TLC|HISTORY\s*TV\s*18|NAT\s*GEO|NATIONAL\s*GEOGRAPHIC|TRAVELXP|HUNGAMA|POGO|CARTOON\s*NETWORK|NICKELODEON|NICK|SONIC\s*NICKELODEON|DISNEY|9XM|9X\s*JALWA|MASTIII|ZOOM\s*TV|MTV\s*(?:BEATS|INDIA)|SHOWBOX|E24|ZING|AASTHA|SANSKAR|SADHNA)\b/i;

export function displayCategoryName(category = ""): string {
  const stripped = String(category)
    .trim()
    .replace(/^[|\[(\{\s]*(?:IN|IND|INDIA|INDIAN|VIP)[|\])\}\s:\-–—]+/i, "")
    .replace(/^[|:\-–—\s]+|[|:\-–—\s]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return stripped || String(category).trim() || "Live TV";
}

export function categoryRank(category = ""): number {
  const lower = displayCategoryName(category).toLowerCase();
  const isIndia = INDIA_TAG_RE.test(category) || lower.includes("hindi") || lower.includes("bollywood");
  let base = 9;
  if (/cricket|ipl|sport/.test(lower)) base = 0;
  else if (/entertainment|gec|general|serial/.test(lower)) base = 1;
  else if (/movie|cinema|bollywood|film|dual audio/.test(lower)) base = 2;
  else if (/news|business/.test(lower)) base = 3;
  else if (/knowledge|infotainment|documentary|discovery|science/.test(lower)) base = 4;
  else if (/kid|cartoon|anime/.test(lower)) base = 5;
  else if (/music|youth/.test(lower)) base = 6;
  else if (/spiritual|devotional|religious|bhakti/.test(lower)) base = 7;
  return isIndia ? base : base + 12;
}

export function keepsIndianHindi(name = "", category = ""): boolean {
  const combined = `${category} ${name}`;
  if (ADULT_RE.test(combined)) return false;
  const explicitHindi = HINDI_EXPLICIT_RE.test(combined);
  if (!explicitHindi && REGIONAL_NON_HINDI_RE.test(combined)) return false;
  const isCricket = CRICKET_RE.test(combined);
  if (!explicitHindi && !INDIA_TAG_RE.test(category) && !isCricket) {
    if (FOREIGN_STRICT_RE.test(category) || FOREIGN_STRICT_RE.test(name)) return false;
  }
  if (!explicitHindi && !isCricket && FOREIGN_CHANNEL_PREFIX_RE.test(String(name).trim())) return false;
  return (
    explicitHindi ||
    INDIA_TAG_RE.test(combined) ||
    isCricket ||
    INDIAN_SPORTS_RE.test(combined) ||
    INDIAN_BROADCASTER_RE.test(name)
  );
}

export function keepsByFilter(name = "", category = "", filter = "hindi"): boolean {
  const f = String(filter || "hindi").toLowerCase();
  if (f === "all") return !ADULT_RE.test(`${category} ${name}`);
  if (f === "en_hi" || f === "english") {
    if (ADULT_RE.test(`${category} ${name}`)) return false;
    if (REGIONAL_NON_HINDI_RE.test(`${category} ${name}`) && !HINDI_EXPLICIT_RE.test(`${category} ${name}`)) return false;
    return !FOREIGN_CHANNEL_PREFIX_RE.test(String(name).trim());
  }
  return keepsIndianHindi(name, category);
}

// ---------- Stalker portal client (maxTV) ----------
//
// Ported from the working Android implementation in creatorAkshanshsahu/v.4.9
// (app/src/main/java/com/aktv/app/StalkerPortal.kt + StalkerProtocol.kt).
// The sequence a MAG set-top box performs is reproduced exactly:
//   handshake -> get_profile -> get_genres/get_all_channels -> create_link
// The address the portal's `server/load.php` actually lives at is discovered,
// not guessed, because the configured web-client path is usually not the API.

/** One channel exactly as the portal advertises it. `cmd` is the handle traded for a stream URL. */
interface StalkerChannel {
  id: string;
  name: string;
  cmd: string;
  genre: string;
  logo: string;
}

/** The device identity a portal recognises. Defaults are the working set from the Android app. */
interface StalkerAccount {
  portal: string;
  mac: string;
  serial: string;
  deviceId: string;
}

const STALKER_DEFAULT_PORTAL = "http://new.maxtv.be/stalker_portal/c/";
const STALKER_DEFAULT_MAC = "00:1A:79:EE:03:9F";
const STALKER_DEFAULT_SERIAL = "92180365D21FE";
const STALKER_DEFAULT_DEVICE = "3610DEAFB556781F84CBC8A6AF876A8F20637668862B28DEECFACE00D67A6070";

/** `server/load.php` — the API every panel action is posted to. */
const STALKER_API = "server/load.php";

function stalkerOrigin(url: string): string {
  try {
    const u = new URL(url.trim());
    return `${u.protocol}//${u.host}`;
  } catch {
    return url.trim().replace(/\/+$/, "");
  }
}

/**
 * Every address a portal's API may live at, in the order the Android app tries them.
 *
 * The configured value is the *web client* path (`http://host/stalker_portal/c/`) and its
 * `server/load.php` is normally one level up, at `http://host/stalker_portal/server/load.php`.
 * Asking only for `<configured>/server/load.php` is what produces a 404 on most panels.
 */
function stalkerCandidates(portalUrl: string): string[] {
  const configured = (portalUrl || STALKER_DEFAULT_PORTAL).trim().replace(/\/+$/, "");
  const origin = stalkerOrigin(configured);
  const out = new Set<string>();
  const add = (url: string) => {
    if (url.startsWith("http")) out.add(url);
  };

  // Exactly as configured.
  add(`${configured}/${STALKER_API}`);
  // The web-client path is not the API: its load.php sits one level up.
  if (configured.endsWith("/c")) add(`${configured.slice(0, -2)}/${STALKER_API}`);
  add(`${configured}/portal.php`);
  // The same files on the bare host.
  add(`${origin}/stalker_portal/${STALKER_API}`);
  add(`${origin}/${STALKER_API}`);
  add(`${origin}/portal.php`);
  add(`${origin}/stalker_portal/portal.php`);
  // A panel that only answers over TLS.
  if (configured.startsWith("http://")) {
    const secure = `https://${configured.slice("http://".length)}`;
    add(`${secure}/${STALKER_API}`);
    if (secure.endsWith("/c")) add(`${secure.slice(0, -2)}/${STALKER_API}`);
  }
  return [...out];
}

/** A portal answered, but not with something usable. Carries the portal's own refusal when it gave one. */
class StalkerError extends Error {
  readonly status: number | null;
  readonly detail: string;
  constructor(status: number | null = null, detail = "") {
    super(status !== null ? `The portal refused the request (HTTP ${status})` : detail || "The portal did not answer with a usable response");
    this.name = "StalkerError";
    this.status = status;
    this.detail = detail;
  }
}

function parseEnvelope(body: string): Record<string, unknown> | unknown[] | null {
  const text = String(body || "").trim().replace(/^\/\*\*\//, "").trim();
  const brace = text.indexOf("{");
  const bracket = text.indexOf("[");
  const starts = [brace, bracket].filter((i) => i >= 0);
  if (!starts.length) return null;
  try {
    const at = Math.min(...starts);
    if (!Number.isFinite(at)) return null;
    return JSON.parse(text.slice(at)) as Record<string, unknown> | unknown[];
  } catch {
    return null;
  }
}

/** The `js` envelope, or the root object when the portal did not wrap its answer. */
function stalkerJs(body: string): Record<string, unknown> | null {
  const root = parseEnvelope(body);
  if (!root || Array.isArray(root)) return null;
  const js = root["js"];
  return js && typeof js === "object" && !Array.isArray(js) ? (js as Record<string, unknown>) : root;
}

/** The session token a handshake issues. */
function stalkerToken(body: string): string | null {
  const js = stalkerJs(body);
  const tok = js?.["token"];
  return typeof tok === "string" && tok.trim() ? tok.trim() : null;
}

/** The portal's own refusal text, when it sent one. */
function stalkerError(body: string): string | null {
  const js = stalkerJs(body);
  const root = parseEnvelope(body);
  const rootObj = root && !Array.isArray(root) ? root : null;
  const text =
    (typeof js?.["error"] === "string" && js["error"]) ||
    (typeof js?.["msg"] === "string" && js["msg"]) ||
    (typeof rootObj?.["error"] === "string" && rootObj["error"]) ||
    "";
  return String(text).trim() || null;
}

/** True when the portal says the token is gone, so the caller has to handshake again. */
function isStalkerExpired(body: string): boolean {
  const root = parseEnvelope(body);
  if (!root || Array.isArray(root)) return false;
  const js = (root["js"] && typeof root["js"] === "object" ? root["js"] : root) as Record<string, unknown>;
  const flag = js["not_valid"];
  if (flag === true) return true;
  if (typeof flag === "number" && flag !== 0) return true;
  const msg = `${String(js["error"] ?? "")} ${String(js["msg"] ?? "")} ${String(root["error"] ?? "")}`.toLowerCase();
  return msg.includes("authorization failed") || msg.includes("not valid") || (msg.includes("token") && msg.includes("expire"));
}

/** `get_all_channels`: the `js.data` array of `{id, name, cmd, tv_genre_id, logo}`. */
function stalkerChannels(body: string): StalkerChannel[] {
  const js = stalkerJs(body);
  const data = js?.["data"];
  if (!Array.isArray(data)) return [];
  const out: StalkerChannel[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const cmd = String(rec["cmd"] ?? "").trim();
    const name = String(rec["name"] ?? rec["title"] ?? "").trim();
    const id = String(rec["id"] ?? rec["ch_id"] ?? "").trim();
    // A row without a name or without a handle cannot be shown or played.
    if (!cmd || !name) continue;
    out.push({
      id: id || name,
      name,
      cmd,
      genre: String(rec["tv_genre_id"] ?? "").trim(),
      logo: String(rec["logo"] ?? "").trim(),
    });
  }
  return out;
}

/** `get_genres`: `[{id, title}]`, or the same array under `js`. */
function stalkerGenres(body: string): Map<string, string> {
  const root = parseEnvelope(body);
  let array: unknown[] | null = null;
  if (Array.isArray(root)) array = root;
  else if (root && typeof root === "object") {
    const jsRaw = root["js"];
    if (jsRaw && typeof jsRaw === "object" && !Array.isArray(jsRaw)) {
      const nested = (jsRaw as Record<string, unknown>)["data"];
      if (Array.isArray(nested)) array = nested;
    } else if (Array.isArray(jsRaw)) array = jsRaw;
    if (!array) {
      const data = root["data"];
      if (Array.isArray(data)) array = data;
    }
  }
  const out = new Map<string, string>();
  if (!array) return out;
  for (const item of array) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = String(rec["id"] ?? "").trim();
    const title = String(rec["title"] ?? "").trim();
    if (id && title) out.set(id, title);
  }
  return out;
}

/** `create_link`: the raw `js.cmd` handle, still carrying the player's `ffmpeg ` prefix. */
function stalkerLink(body: string): string | null {
  const js = stalkerJs(body);
  const cmd = js?.["cmd"];
  return typeof cmd === "string" && cmd.trim() ? cmd.trim() : null;
}

/**
 * The URL inside a portal command. Portals answer `ffmpeg http://host/…/index.m3u8`, and some append
 * Kodi-style `|User-Agent=…` parameters that players cannot use, so both are cut away here.
 */
function extractStalkerStreamUrl(cmd: string): string | null {
  const clean = String(cmd || "")
    .trim()
    .replace(/^ffmpeg/i, "")
    .trim()
    .split("|")[0]
    ?.trim() ?? "";
  return /^(?:https?|rtsp):\/\//i.test(clean) ? clean : null;
}

async function fetchTextTimeout(url: string, headers: Record<string, string>, timeoutMs = 20000): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (res.status !== 200) throw new StalkerError(res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

const stalkerSession: {
  endpoint: string | null;
  token: string | null;
  profiled: boolean;
} = { endpoint: null, token: null, profiled: false };

function stalkerAccount(cfg: GatewayConfig): StalkerAccount {
  return {
    portal: cfg.maxtvPortal,
    mac: cfg.maxtvMac,
    serial: cfg.maxtvSerial,
    deviceId: cfg.maxtvDeviceId,
  };
}

function stalkerHeaders(cfg: GatewayConfig, account: StalkerAccount, auth: boolean): Record<string, string> {
  const h: Record<string, string> = {
    Cookie: `mac=${encodeURIComponent(account.mac)}; stb_lang=en; timezone=Europe/London`,
    "User-Agent": MAG_USER_AGENT,
    "X-User-Agent": MAG_DEVICE_UA,
    Accept: "*/*",
    // The web-client path the portal was issued with, independent of where its API turned out to be.
    Referer: `${cfg.maxtvPortal.replace(/\/+$/, "")}/`,
  };
  if (auth && stalkerSession.token) h["Authorization"] = `Bearer ${stalkerSession.token}`;
  return h;
}

function buildStalkerUrl(base: string, type: string, action: string, params: Record<string, string>): string {
  const url = new URL(base);
  url.searchParams.set("type", type);
  url.searchParams.set("action", action);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("JsHttpRequest", "1-xml");
  return url.toString();
}

async function stalkerRaw(
  cfg: GatewayConfig,
  account: StalkerAccount,
  base: string,
  type: string,
  action: string,
  params: Record<string, string>,
  auth: boolean,
): Promise<string> {
  const body = await fetchTextTimeout(buildStalkerUrl(base, type, action, params), stalkerHeaders(cfg, account, auth), 20000);
  return body;
}

/**
 * Asks every candidate address for a handshake once and keeps the one that answers with a token.
 * A portal that refuses in its own words (expired MAC, too many connections) is reported in those
 * words instead of as a list of HTTP codes.
 */
async function stalkerHandshake(cfg: GatewayConfig): Promise<string> {
  const account = stalkerAccount(cfg);
  if (stalkerSession.endpoint) {
    const body = await stalkerRaw(cfg, account, stalkerSession.endpoint, "stb", "handshake", { token: "", prehash: "0" }, false);
    const issued = stalkerToken(body);
    if (!issued) throw new StalkerError(null, stalkerError(body) ?? "the portal issued no token");
    stalkerSession.token = issued;
    stalkerSession.profiled = false;
    return issued;
  }

  const failures: string[] = [];
  let spoken: string | null = null;
  let lastErr: unknown = null;

  for (const candidate of stalkerCandidates(cfg.maxtvPortal)) {
    try {
      const body = await stalkerRaw(cfg, account, candidate, "stb", "handshake", { token: "", prehash: "0" }, false);
      const issued = stalkerToken(body);
      if (!issued) {
        const detail = stalkerError(body);
        if (detail && !spoken) spoken = detail;
        failures.push(`${candidate} no token`);
        continue;
      }
      stalkerSession.endpoint = candidate;
      stalkerSession.token = issued;
      stalkerSession.profiled = false;
      return issued;
    } catch (e) {
      lastErr = e;
      if (e instanceof StalkerError) {
        if (e.status === null && e.detail && !spoken) spoken = e.detail;
        failures.push(`${candidate} ${e.status !== null ? `HTTP ${e.status}` : "no token"}`);
      } else {
        failures.push(`${candidate} ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  stalkerSession.endpoint = null;
  stalkerSession.token = null;
  const tried = failures.slice(0, 4).join(", ") + (failures.length > 4 ? " …" : "");
  const detail = spoken ?? (failures.length ? `no portal at this address (tried ${tried})` : "no portal at this address");
  if (lastErr instanceof StalkerError) throw new StalkerError(lastErr.status, lastErr.detail || detail);
  throw new StalkerError(null, detail);
}

async function stalkerRequest(
  cfg: GatewayConfig,
  type: string,
  action: string,
  params: Record<string, string>,
  retried = false,
): Promise<string> {
  const account = stalkerAccount(cfg);
  if (!stalkerSession.token || !stalkerSession.endpoint) await stalkerHandshake(cfg);

  if (!stalkerSession.profiled && stalkerSession.endpoint) {
    stalkerSession.profiled = true;
    // Some portals answer get_profile only after a second step they do not advertise; the token is
    // what the catalogue calls need, so a refusal here is not fatal.
    try {
      await stalkerRaw(
        cfg,
        account,
        stalkerSession.endpoint,
        "stb",
        "get_profile",
        {
          hd: "1",
          auth_second_step: "1",
          prehash: "0",
          num_banks: "2",
          stb_type: "MAG254",
          sn: account.serial,
          device_id: account.deviceId,
          device_id2: account.deviceId,
          signature: "",
          client_type: "STB",
          image_version: "218",
          video_out: "hdmi",
          hw_version: "1.7-BD-00",
          api_signature: "262",
        },
        true,
      );
    } catch {
      // non-fatal on portals that do not enforce get_profile
    }
  }

  if (!stalkerSession.endpoint) throw new StalkerError(null, "no portal address was reached");
  const body = await stalkerRaw(cfg, account, stalkerSession.endpoint, type, action, params, true);

  // An expired token is normal on a portal that sat idle; handshake once and repeat the call.
  if (!retried && isStalkerExpired(body)) {
    stalkerSession.token = null;
    stalkerSession.endpoint = null;
    await stalkerHandshake(cfg);
    return stalkerRequest(cfg, type, action, params, true);
  }
  return body;
}

/** The whole maxTV catalogue, in the order the portal lists it. */
async function fetchMaxtvCatalogue(cfg: GatewayConfig): Promise<{ channels: LiveChannelItem[]; endpoint: string | null }> {
  const account = stalkerAccount(cfg);
  const channelsBody = await stalkerRequest(cfg, "itv", "get_all_channels", {});
  const listed = stalkerChannels(channelsBody);
  if (listed.length === 0) {
    throw new StalkerError(null, stalkerError(channelsBody) ?? "The portal lists no channels");
  }

  // Genres are best effort: a portal may refuse them without refusing the channels.
  let genres = new Map<string, string>();
  try {
    genres = stalkerGenres(await stalkerRequest(cfg, "itv", "get_genres", {}));
  } catch {
    genres = new Map();
  }

  const origin = stalkerOrigin(account.portal);
  const channels: LiveChannelItem[] = listed.map((c) => {
    const genre = genres.get(c.genre);
    return {
      id: `st:${c.id}`,
      rawId: c.id,
      source: "maxtv" as const,
      name: c.name,
      // The portal publishes logo paths relative to its own host.
      category: genre && genre.trim() && genre !== "*" && genre.toLowerCase() !== "all" ? genre : "maxTV",
      logo: c.logo.startsWith("/") ? `${origin}${c.logo}` : c.logo,
      cmd: c.cmd,
    };
  });

  return { channels, endpoint: stalkerSession.endpoint };
}

/** The playable URL for one channel handle. */
async function resolveMaxtvLink(cfg: GatewayConfig, cmd: string): Promise<string> {
  const body = await stalkerRequest(cfg, "itv", "create_link", {
    cmd,
    series: "",
    forced_storage: "",
    disable_ad: "0",
    download: "0",
    force_ch_link_check: "0",
  });
  // A portal may hand back the channel's own address unchanged; that is a valid answer too.
  const url = extractStalkerStreamUrl(stalkerLink(body) ?? "") || extractStalkerStreamUrl(cmd);
  if (!url) throw new StalkerError(null, stalkerError(body) ?? "The portal returned no playable link for this channel");
  return url;
}

const xtreamState: { workingOrigin: string; canonUser: string; canonPass: string } = {
  workingOrigin: "",
  canonUser: "",
  canonPass: "",
};

async function fetchStarshareCatalogue(cfg: GatewayConfig): Promise<LiveChannelItem[]> {
  if (!cfg.starshareUser || !cfg.starsharePass) return [];
  const origins = [cfg.starshareServer, cfg.starshareFallback].filter(Boolean).map((u) => u.replace(/\/+$/, ""));
  let lastErr: unknown = null;
  for (const origin of origins) {
    try {
      const u = encodeURIComponent(cfg.starshareUser);
      const p = encodeURIComponent(cfg.starsharePass);
      const authText = await fetchTextTimeout(
        `${origin}/player_api.php?username=${u}&password=${p}`,
        { "User-Agent": XTREAM_USER_AGENT, Accept: "application/json" },
        12000,
      );
      const auth = JSON.parse(authText) as { user_info?: Record<string, unknown> };
      const ui = auth?.user_info;
      if (!ui || !(ui["auth"] === 1 || ui["auth"] === "1" || ui["status"] === "Active")) {
        throw new Error("StarShare auth rejected");
      }
      xtreamState.workingOrigin = origin;
      xtreamState.canonUser = String(ui["username"] || cfg.starshareUser).trim();
      xtreamState.canonPass = String(ui["password"] || cfg.starsharePass).trim();

      const cu = encodeURIComponent(xtreamState.canonUser);
      const cp = encodeURIComponent(xtreamState.canonPass);
      const catsRaw = await fetchTextTimeout(
        `${origin}/player_api.php?username=${cu}&password=${cp}&action=get_live_categories`,
        { "User-Agent": XTREAM_USER_AGENT, Accept: "application/json" },
        18000,
      ).catch(() => "[]");
      const catsMap = new Map<string, string>();
      for (const c of JSON.parse(catsRaw) as Array<Record<string, unknown>>) {
        if (c?.["category_id"] && c?.["category_name"]) catsMap.set(String(c["category_id"]), String(c["category_name"]).trim());
      }

      const streamsRaw = await fetchTextTimeout(
        `${origin}/player_api.php?username=${cu}&password=${cp}&action=get_live_streams`,
        { "User-Agent": XTREAM_USER_AGENT, Accept: "application/json" },
        30000,
      );
      const arr = JSON.parse(streamsRaw) as Array<Record<string, unknown>>;
      return arr
        .filter((it) => it?.["stream_id"] && it?.["name"])
        .map((it) => ({
          id: `xt:${String(it["stream_id"])}`,
          rawId: String(it["stream_id"]),
          source: "starshare" as const,
          name: String(it["name"]).trim(),
          category: catsMap.get(String(it["category_id"])) || "StarShare Live",
          logo: String(it["stream_icon"] || "").trim(),
        }));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("StarShare unreachable");
}

// ---------- In-Memory Catalogue Cache ----------

const memCache: {
  maxtv: { items: LiveChannelItem[]; fetchedAt: number; usingSeed: boolean; error: string | null; endpoint: string | null };
  starshare: { items: LiveChannelItem[]; fetchedAt: number; error: string | null };
} = {
  maxtv: { items: [], fetchedAt: 0, usingSeed: false, error: null, endpoint: null },
  starshare: { items: [], fetchedAt: 0, error: null },
};

async function loadMaxtvCached(cfg: GatewayConfig, force = false): Promise<LiveChannelItem[]> {
  if (!force && memCache.maxtv.items.length > 0 && !memCache.maxtv.usingSeed && Date.now() - memCache.maxtv.fetchedAt < CATALOGUE_TTL_MS) {
    return memCache.maxtv.items;
  }
  try {
    const { channels: live, endpoint } = await fetchMaxtvCatalogue(cfg);
    // Remember the address that answered so later calls skip discovery.
    if (endpoint) memCache.maxtv.endpoint = endpoint;
    memCache.maxtv = { items: live, fetchedAt: Date.now(), usingSeed: false, error: null, endpoint: endpoint ?? memCache.maxtv.endpoint };
    return live;
  } catch (e) {
    const fallback = memCache.maxtv.items.length > 0 ? memCache.maxtv.items : PREVIEW_SEED_CHANNELS;
    memCache.maxtv = {
      items: fallback,
      fetchedAt: Date.now(),
      usingSeed: fallback === PREVIEW_SEED_CHANNELS,
      error: e instanceof Error ? e.message : String(e),
      endpoint: memCache.maxtv.endpoint,
    };
    return fallback;
  }
}

async function loadStarshareCached(cfg: GatewayConfig, force = false): Promise<LiveChannelItem[]> {
  if (!force && memCache.starshare.items.length > 0 && Date.now() - memCache.starshare.fetchedAt < CATALOGUE_TTL_MS) {
    return memCache.starshare.items;
  }
  try {
    const live = await fetchStarshareCatalogue(cfg);
    memCache.starshare = { items: live, fetchedAt: Date.now(), error: null };
    return live;
  } catch (e) {
    memCache.starshare = {
      items: memCache.starshare.items,
      fetchedAt: Date.now(),
      error: e instanceof Error ? e.message : String(e),
    };
    return memCache.starshare.items;
  }
}

async function getChannelsBySource(cfg: GatewayConfig, source: string, force = false): Promise<LiveChannelItem[]> {
  const s = source.toLowerCase();
  if (s === "starshare") return loadStarshareCached(cfg, force);
  if (s === "all") {
    const [m, x] = await Promise.all([loadMaxtvCached(cfg, force), loadStarshareCached(cfg, force)]);
    return [...m, ...x];
  }
  return loadMaxtvCached(cfg, force);
}

// ---------- Web Crypto HMAC Signing for HLS Segments ----------

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function signSegmentToken(url: string, mode: "mag" | "xtream", secret: string): Promise<string> {
  const enc = new TextEncoder();
  const payload = toBase64Url(enc.encode(JSON.stringify({ u: url, m: mode })));
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  const sig = toBase64Url(new Uint8Array(sigBuf)).slice(0, 22);
  return `${payload}.${sig}`;
}

async function verifySegmentToken(token: string, secret: string): Promise<{ u: string; m: "mag" | "xtream" } | null> {
  const [payload, sig] = String(token || "").split(".");
  if (!payload || !sig) return null;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  const expected = toBase64Url(new Uint8Array(sigBuf)).slice(0, 22);
  if (sig !== expected) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as { u?: string; m?: "mag" | "xtream" };
    if (!parsed?.u || !/^https?:\/\//i.test(parsed.u)) return null;
    return { u: parsed.u, m: parsed.m === "xtream" ? "xtream" : "mag" };
  } catch {
    return null;
  }
}

async function rewriteHlsManifestWeb(
  manifestText: string,
  baseUrl: string,
  mode: "mag" | "xtream",
  publicOrigin: string,
  secret: string,
): Promise<string> {
  const lines = manifestText.split(/\r?\n/);
  const out: string[] = [];
  const signRef = async (ref: string): Promise<string> => {
    const trimmed = ref.trim();
    if (!trimmed) return ref;
    let abs: string;
    try {
      abs = new URL(trimmed, baseUrl).toString();
    } catch {
      return ref;
    }
    const tok = await signSegmentToken(abs, mode, secret);
    return `${publicOrigin}/api/live/segment?t=${encodeURIComponent(tok)}`;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push(line);
      continue;
    }
    if (trimmed.startsWith("#")) {
      const m = trimmed.match(/URI="([^"]+)"/);
      if (m?.[1]) {
        const signed = await signRef(m[1]);
        out.push(line.replace(/URI="([^"]+)"/, `URI="${signed}"`));
      } else {
        out.push(line);
      }
      continue;
    }
    out.push(await signRef(trimmed));
  }
  return out.join("\n");
}

function corsEmbedHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type, Accept, Origin",
    "Access-Control-Expose-Headers": "Content-Type, X-Stream-Container",
    "Content-Security-Policy": "frame-ancestors *;",
    ...extra,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: corsEmbedHeaders({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    }),
  });
}

async function proxyMediaStream(
  upstreamUrl: string,
  mode: "mag" | "xtream",
  publicOrigin: string,
  secret: string,
): Promise<Response> {
  const headers: Record<string, string> =
    mode === "xtream"
      ? { "User-Agent": XTREAM_USER_AGENT, Accept: "*/*", "Icy-MetaData": "1" }
      : { "User-Agent": MAG_USER_AGENT, "X-User-Agent": MAG_DEVICE_UA, Accept: "*/*", "Icy-MetaData": "1" };

  let currentUrl = upstreamUrl;
  let upRes: Response | null = null;
  for (let hop = 0; hop < 6; hop++) {
    const res = await fetch(currentUrl, { headers, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (loc) {
        currentUrl = new URL(loc, currentUrl).toString();
        continue;
      }
    }
    upRes = res;
    break;
  }

  if (!upRes || !upRes.ok || !upRes.body) {
    return jsonResponse(upRes?.status === 404 ? 404 : 502, {
      ok: false,
      error: `Upstream stream returned HTTP ${upRes?.status ?? 502}`,
    });
  }

  const reader = upRes.body.getReader();
  const first = await reader.read();
  if (first.done || !first.value) {
    return jsonResponse(502, { ok: false, error: "Upstream stream closed immediately" });
  }

  const ctype = (upRes.headers.get("content-type") || "").toLowerCase();
  const headText = new TextDecoder().decode(first.value.subarray(0, 32)).trimStart();
  const isHls = ctype.includes("mpegurl") || currentUrl.split("?")[0]!.toLowerCase().endsWith(".m3u8") || headText.startsWith("#EXTM3U");

  if (isHls) {
    const chunks: Uint8Array[] = [first.value];
    let total = first.value.byteLength;
    while (total < 2 * 1024 * 1024) {
      const next = await reader.read();
      if (next.done || !next.value) break;
      chunks.push(next.value);
      total += next.value.byteLength;
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    const manifestText = new TextDecoder().decode(merged);
    const rewritten = await rewriteHlsManifestWeb(manifestText, currentUrl, mode, publicOrigin, secret);
    return new Response(rewritten, {
      status: 200,
      headers: corsEmbedHeaders({
        "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Stream-Container": "hls",
      }),
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(first.value!);
    },
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) controller.close();
        else if (chunk.value) controller.enqueue(chunk.value);
      } catch {
        controller.close();
      }
    },
    cancel() {
      void reader.cancel();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: corsEmbedHeaders({
      "Content-Type": "video/mp2t",
      "Cache-Control": "no-store",
      "X-Stream-Container": "mpegts",
    }),
  });
}

function renderStandaloneEmbedHtml(ch: LiveChannelDto): string {
  const boot = JSON.stringify(ch).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${ch.name.replace(/[<>&"]/g, "")} · STREAMR Live</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; background: #000; color: #f6f7fc; font-family: system-ui, sans-serif; overflow: hidden; }
    .stage { position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #05040b; }
    video { width: 100%; height: 100%; object-fit: contain; background: #000; }
    .top { position: absolute; top: 0; inset-inline: 0; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; background: linear-gradient(180deg, rgba(0,0,0,.78), transparent); pointer-events: none; }
    .live { background: #ff2e63; color: #fff; font-size: 10px; font-weight: 800; letter-spacing: .14em; padding: 3px 8px; border-radius: 999px; margin-right: 8px; }
    .bot { position: absolute; bottom: 0; inset-inline: 0; padding: 12px 16px; display: flex; justify-content: space-between; gap: 8px; background: linear-gradient(0deg, rgba(0,0,0,.85), transparent); }
    button, select { background: rgba(16,14,30,.85); color: #fff; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; padding: 6px 12px; font-size: 12px; font-weight: 600; cursor: pointer; }
    button:hover, select:hover { border-color: #00ecf7; }
    .ov { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; background: rgba(5,4,11,.74); text-align: center; padding: 20px; }
    .ov.hide { display: none; }
  </style>
</head>
<body>
  <div class="stage" id="stage">
    <video id="v" playsinline autoplay></video>
    <div class="top">
      <div><span class="live">LIVE</span><strong id="nm"></strong></div>
      <span style="font-size:11px;opacity:.7;letter-spacing:.12em;">STREAMR · maxTV</span>
    </div>
    <div class="ov" id="ov"><div id="st" style="font-size:13px;color:#b4bbd0;">Connecting to live stream…</div><button id="rt" style="display:none;">Reload Stream</button></div>
    <div class="bot">
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button id="pl">Pause</button>
        <button id="mu">Mute</button>
        <button id="rl">Reload</button>
        <select id="au" style="display:none;"></select>
      </div>
      <div><button id="fs">Fullscreen</button></div>
    </div>
  </div>
  <script src="/vendor/mpegts.js"></script>
  <script src="/vendor/hls.min.js"></script>
  <script>
    const ch = ${boot};
    const v = document.getElementById("v"), ov = document.getElementById("ov"), st = document.getElementById("st"), rt = document.getElementById("rt"), au = document.getElementById("au"), mu = document.getElementById("mu"), pl = document.getElementById("pl");
    document.getElementById("nm").textContent = ch.name;
    if (new URLSearchParams(location.search).get("muted") === "1") { v.muted = true; mu.textContent = "Unmute"; }
    let mp = null, hp = null;
    function clean() {
      if (mp) { try { mp.unload(); mp.detachMediaElement(); mp.destroy(); } catch {} mp = null; }
      if (hp) { try { hp.destroy(); } catch {} hp = null; }
      au.style.display = "none"; au.innerHTML = "";
    }
    function sUrl(ext) { return "/api/live/stream/" + encodeURIComponent(ch.id) + ext + "?_t=" + Date.now(); }
    function startHls(url) {
      clean();
      if (window.Hls && Hls.isSupported()) {
        hp = new Hls({ lowLatencyMode: true });
        hp.loadSource(url); hp.attachMedia(v);
        hp.on(Hls.Events.MANIFEST_PARSED, () => {
          const tr = hp.audioTracks || [];
          if (tr.length > 1) {
            let hi = -1;
            tr.forEach((t, i) => {
              const o = document.createElement("option");
              o.value = i; o.textContent = "Audio: " + ([t.name, t.lang].filter(Boolean).join(" · ") || ("Track " + (i + 1)));
              if (hi < 0 && /hin|^hi$/i.test((t.name || "") + " " + (t.lang || ""))) hi = i;
              au.appendChild(o);
            });
            if (hi >= 0) hp.audioTrack = hi;
            au.value = hp.audioTrack; au.style.display = "inline-block";
            au.onchange = () => { hp.audioTrack = Number(au.value); };
          }
          v.play().catch(() => { v.muted = true; mu.textContent = "Unmute"; v.play().catch(() => {}); });
        });
      } else { v.src = url; v.play().catch(() => {}); }
    }
    function startTs(url, fallback) {
      clean();
      if (!window.mpegts || !mpegts.isSupported()) return startHls(sUrl(".m3u8"));
      mp = mpegts.createPlayer({ type: "mpegts", isLive: true, url }, { enableWorker: true, enableStashBuffer: false, liveBufferLatencyChasing: true });
      mp.attachMediaElement(v); mp.load();
      Promise.resolve(mp.play()).catch(() => { v.muted = true; mu.textContent = "Unmute"; v.play().catch(() => {}); });
      mp.on(mpegts.Events.ERROR, () => { if (fallback) startHls(sUrl(".m3u8")); else { st.textContent = "Stream interrupted."; rt.style.display = "inline-block"; ov.classList.remove("hide"); } });
    }
    async function boot() {
      clean(); ov.classList.remove("hide"); rt.style.display = "none"; st.textContent = "Connecting to " + ch.name + "…";
      const c = new AbortController(); const tm = setTimeout(() => c.abort(), 8000);
      try {
        const r = await fetch(sUrl(".ts"), { signal: c.signal }); clearTimeout(tm);
        if (!r.ok) { const j = await r.json().catch(() => ({})); c.abort(); st.textContent = j.error || ("HTTP " + r.status); rt.style.display = "inline-block"; return; }
        const kind = (r.headers.get("x-stream-container") || "").toLowerCase(); c.abort();
        if (kind === "hls") startHls(sUrl(".m3u8")); else startTs(sUrl(".ts"), true);
      } catch { clearTimeout(tm); startTs(sUrl(".ts"), true); }
    }
    v.onplaying = () => { ov.classList.add("hide"); pl.textContent = "Pause"; };
    v.onpause = () => { pl.textContent = "Play"; };
    pl.onclick = () => v.paused ? v.play() : v.pause();
    mu.onclick = () => { v.muted = !v.muted; mu.textContent = v.muted ? "Unmute" : "Mute"; };
    document.getElementById("rl").onclick = boot; rt.onclick = boot;
    document.getElementById("fs").onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.getElementById("stage").requestFullscreen();
    boot();
  </script>
</body>
</html>`;
}

function renderWidgetSdkJs(): string {
  return `(function(){
  const s = document.currentScript || document.querySelector('script[src*="embed-sdk.js"]');
  if (!s) return;
  const origin = new URL(s.src, location.href).origin;
  const mount = document.querySelector(s.getAttribute("data-target") || "#og-live-tv");
  const source = s.getAttribute("data-source") || "maxtv";
  const filter = s.getAttribute("data-filter") || "hindi";
  if (!mount) return;
  mount.innerHTML = '<div style="background:#080711;border:1px solid rgba(255,255,255,.1);border-radius:16px;overflow:hidden;color:#fff;font-family:system-ui,sans-serif;"><div style="aspect-ratio:16/9;background:#000;"><iframe id="sr-f" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen style="width:100%;height:100%;border:0;"></iframe></div><div style="padding:14px;"><input id="sr-q" type="search" placeholder="Search Live TV…" style="width:100%;margin-bottom:10px;background:#121022;border:1px solid rgba(255,255,255,.15);color:#fff;padding:8px 14px;border-radius:999px;font-size:13px;"/><div id="sr-g" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;max-height:260px;overflow:auto;"></div></div></div>';
  const f = mount.querySelector("#sr-f"), q = mount.querySelector("#sr-q"), g = mount.querySelector("#sr-g");
  let all = [], cur = "";
  function pick(c) { cur = c.id; f.src = origin + "/embed/" + encodeURIComponent(c.id); draw(q.value); }
  function draw(txt) {
    const t = (txt || "").toLowerCase();
    g.innerHTML = "";
    all.filter(c => !t || (c.name + " " + c.category).toLowerCase().includes(t)).slice(0, 120).forEach(c => {
      const b = document.createElement("button");
      b.textContent = c.name;
      b.style.cssText = "text-align:left;padding:8px 10px;border-radius:10px;cursor:pointer;border:1px solid " + (c.id === cur ? "#00ecf7" : "rgba(255,255,255,.1)") + ";background:#121022;color:#fff;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      b.onclick = () => pick(c);
      g.appendChild(b);
    });
  }
  fetch(origin + "/api/live/channels?source=" + encodeURIComponent(source) + "&filter=" + encodeURIComponent(filter))
    .then(r => r.json()).then(d => { all = d.channels || []; if (all[0]) pick(all[0]); });
  q.oninput = () => draw(q.value);
})();`;
}

function toDto(ch: LiveChannelItem, publicOrigin: string): LiveChannelDto {
  const enc = encodeURIComponent(ch.id);
  const embedUrl = `${publicOrigin}/embed/${enc}`;
  return {
    id: ch.id,
    source: ch.source,
    name: ch.name,
    category: displayCategoryName(ch.category),
    rawCategory: ch.category,
    logo: ch.logo,
    embedUrl,
    iframeCode: `<iframe src="${embedUrl}" width="100%" height="100%" frameborder="0" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen></iframe>`,
    streamUrl: `${publicOrigin}/api/live/stream/${enc}.ts`,
  };
}

// ---------- Entry Point Called from src/server.ts ----------

export async function maybeHandleLiveRequest(request: Request, env: unknown): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  const isHandled =
    path.startsWith("/api/live/") ||
    path.startsWith("/embed/") ||
    path === "/embed-sdk.js";

  if (!isHandled) return null;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsEmbedHeaders() });
  }

  const cfg = getConfig(env);
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const publicOrigin = forwardedHost ? `${forwardedProto || url.protocol.replace(":", "")}://${forwardedHost}` : url.origin;

  if (path === "/embed-sdk.js") {
    return new Response(renderWidgetSdkJs(), {
      status: 200,
      headers: corsEmbedHeaders({ "Content-Type": "application/javascript; charset=utf-8" }),
    });
  }

  if (path === "/api/live/channels") {
    const source = url.searchParams.get("source") || "maxtv";
    const filter = url.searchParams.get("filter") || "hindi";
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    const category = (url.searchParams.get("category") || "").trim().toLowerCase();
    const force = url.searchParams.get("refresh") === "1";
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 1500), 1), 10000);

    const raw = await getChannelsBySource(cfg, source, force);
    let filtered = raw.filter((c) => keepsByFilter(c.name, c.category, filter));
    if (filtered.length === 0 && filter !== "all") filtered = raw;

    if (category) {
      filtered = filtered.filter(
        (c) => displayCategoryName(c.category).toLowerCase() === category || c.category.toLowerCase() === category,
      );
    }
    if (q) {
      const toks = q.split(/\s+/).filter(Boolean);
      filtered = filtered.filter((c) => {
        const hay = `${c.name} ${c.category}`.toLowerCase();
        return toks.every((t) => hay.includes(t));
      });
    }

    filtered.sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || a.name.localeCompare(b.name));
    const categories = [...new Set(filtered.map((c) => displayCategoryName(c.category)))];
    const channels = filtered.slice(0, limit).map((c) => toDto(c, publicOrigin));

    // Never let a seed fallback masquerade as a working catalogue: report why maxTV failed.
    const portalError = source !== "starshare" ? memCache.maxtv.error : null;
    const usingSeed = source !== "starshare" && memCache.maxtv.usingSeed;

    return jsonResponse(200, {
      ok: true,
      source,
      filter,
      totalMatching: filtered.length,
      usingPreviewSeed: usingSeed,
      portalError: usingSeed ? portalError : null,
      portalEndpoint: source !== "starshare" ? memCache.maxtv.endpoint : null,
      categories,
      channels,
    });
  }

  if (path === "/api/live/playlist.m3u") {
    const source = url.searchParams.get("source") || "maxtv";
    const filter = url.searchParams.get("filter") || "hindi";
    const raw = await getChannelsBySource(cfg, source, false);
    let filtered = raw.filter((c) => keepsByFilter(c.name, c.category, filter));
    if (filtered.length === 0 && filter !== "all") filtered = raw;
    filtered.sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || a.name.localeCompare(b.name));

    const lines = ["#EXTM3U"];
    for (const ch of filtered) {
      const safeName = ch.name.replace(/[\r\n]+/g, " ").trim();
      lines.push(
        `#EXTINF:-1 tvg-id="${ch.id}" tvg-logo="${ch.logo.replace(/"/g, "")}" group-title="${displayCategoryName(ch.category).replace(/"/g, "'")}",${safeName}`,
      );
      lines.push(`${publicOrigin}/api/live/stream/${encodeURIComponent(ch.id)}.ts`);
    }
    return new Response(lines.join("\n") + "\n", {
      status: 200,
      headers: corsEmbedHeaders({ "Content-Type": "audio/x-mpegurl; charset=utf-8" }),
    });
  }

  if (path === "/api/live/segment") {
    const tok = url.searchParams.get("t") || "";
    const verified = await verifySegmentToken(tok, cfg.proxySecret);
    if (!verified) return jsonResponse(403, { ok: false, error: "Invalid segment token" });
    return proxyMediaStream(verified.u, verified.m, publicOrigin, cfg.proxySecret);
  }

  if (path.startsWith("/api/live/stream/")) {
    const rawId = decodeURIComponent(path.slice("/api/live/stream/".length)).replace(/\.(?:ts|m3u8)$/i, "");
    const preferHls = path.toLowerCase().endsWith(".m3u8");
    const pool = rawId.startsWith("xt:")
      ? await loadStarshareCached(cfg, false)
      : await getChannelsBySource(cfg, "all", false);
    const ch = pool.find((c) => c.id === rawId || c.rawId === rawId);
    if (!ch) return jsonResponse(404, { ok: false, error: "Channel not found" });

    if (ch.source === "starshare") {
      const origin = (xtreamState.workingOrigin || cfg.starshareServer).replace(/\/+$/, "");
      const u = encodeURIComponent(xtreamState.canonUser || cfg.starshareUser);
      const p = encodeURIComponent(xtreamState.canonPass || cfg.starsharePass);
      return proxyMediaStream(`${origin}/live/${u}/${p}/${ch.rawId}.${preferHls ? "m3u8" : "ts"}`, "xtream", publicOrigin, cfg.proxySecret);
    }

    if (String(ch.cmd || "").startsWith("seed://")) {
      return jsonResponse(503, {
        ok: false,
        error: "Live stream connects directly to maxTV once deployed on Lovable / internet-enabled runtime.",
      });
    }

    try {
      const resolved = await resolveMaxtvLink(cfg, ch.cmd || "");
      return await proxyMediaStream(resolved, "mag", publicOrigin, cfg.proxySecret);
    } catch (e) {
      return jsonResponse(502, { ok: false, error: e instanceof Error ? e.message : "Failed to resolve maxTV link" });
    }
  }

  if (path.startsWith("/embed/")) {
    const rawId = decodeURIComponent(path.slice("/embed/".length));
    const pool = await getChannelsBySource(cfg, "all", false);
    const ch = pool.find((c) => c.id === rawId || c.rawId === rawId);
    const dto = ch
      ? toDto(ch, publicOrigin)
      : {
          id: rawId,
          source: "maxtv" as const,
          name: rawId,
          category: "Live TV",
          rawCategory: "Live TV",
          logo: "",
          embedUrl: `${publicOrigin}${path}`,
          iframeCode: "",
          streamUrl: `${publicOrigin}/api/live/stream/${encodeURIComponent(rawId)}.ts`,
        };
    return new Response(renderStandaloneEmbedHtml(dto), {
      status: 200,
      headers: corsEmbedHeaders({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }),
    });
  }

  return null;
}
