/**
 * Web-Standards Live TV Gateway (`maxTV` Stalker + optional `StarShare` Xtream) for TanStack Start / Cloudflare Workers.
 *
 * Uses only Web-standard `fetch`, `ReadableStream`, `TextEncoder`/`TextDecoder`, and `crypto.subtle`
 * (zero `node:*` imports) so `vite build` with Lovable's Nitro Cloudflare target succeeds cleanly.
 */

export interface LiveChannelItem {
  id: string;
  rawId: string;
  source: "maxtv" | "starshare" | "jio";
  name: string;
  category: string;
  logo: string;
  cmd?: string;
  /** ClearKey material for DRM-protected playlist channels. */
  drm?: { type: "clearkey"; keys: ClearKeyPair[]; licenseUrl?: string };
  /** Transport hints the playlist itself declares. */
  userAgent?: string;
  cookie?: string;
  mediaType?: "hls" | "dash" | "mp4";
}

export interface LiveChannelDto {
  id: string;
  source: "maxtv" | "starshare" | "jio";
  name: string;
  category: string;
  rawCategory: string;
  logo: string;
  embedUrl: string;
  iframeCode: string;
  streamUrl: string;
  /** Present only for DRM channels; the page hands these straight to dash.js. */
  drm?: { type: "clearkey"; keys: Array<{ kid: string; k: string }> };
  container?: "hls" | "dash" | "mp4";
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
  jioPlaylistUrl: string;
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
    jioPlaylistUrl: readEnv(env, "JIO_PLAYLIST_URL", "https://allinonereborn2.online/jiotv-m3u/jtv39.m3u8"),
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

/**
 * Remember a source that recently failed outright, so the catalogue does not spend
 * eight 20-second timeouts on every page load while the host is unreachable.
 */
const sourceBackoff: { maxtvUntil: number; maxtvReason: string | null } = {
  maxtvUntil: 0,
  maxtvReason: null,
};
const SOURCE_BACKOFF_MS = 30_000;

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
  // 8 candidates x 20s was up to ~160s of blank page when the host is a black hole.
  // A reachable portal answers a handshake well inside this.
  const body = await fetchTextTimeout(buildStalkerUrl(base, type, action, params), stalkerHeaders(cfg, account, auth), 7000);
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

  if (Date.now() < sourceBackoff.maxtvUntil) {
    // Recently proven dead: fail fast with the reason we already know.
    throw new StalkerError(null, sourceBackoff.maxtvReason ?? "no portal at this address");
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
      sourceBackoff.maxtvUntil = 0;
      sourceBackoff.maxtvReason = null;
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
  sourceBackoff.maxtvUntil = Date.now() + SOURCE_BACKOFF_MS;
  sourceBackoff.maxtvReason = detail;
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

// ---------- JioTV M3U backup source ----------
//
// A plain HLS playlist used as the fallback when the maxTV portal is unreachable.
// Format is standard extended M3U:
//   #EXTINF:-1 tvg-id="144" tvg-name="Colors HD" tvg-logo="…" group-title="Entertainment", Colors HD
//   https://host/path/144/master.m3u8
// Every stream is HLS, so it is proxied through the same manifest rewriter that
// mpegts/HLS playback already uses.

interface ParsedM3uEntry {
  name: string;
  url: string;
  tvgId: string;
  logo: string;
  group: string;
  /** `#KODIPROP:...license_type=clearkey` — these channels are DRM protected. */
  licenseType: string;
  /** `#KODIPROP:...license_key=…`; either a key-document URL or an inline `kid:key`. */
  licenseKey: string;
  /** `#EXTVLCOPT:http-user-agent=…` — the playlist's own UA, required by the media host. */
  userAgent: string;
  /** `#EXTHTTP:{"cookie":"…"}` — a CDN token, only for the playlist host. */
  cookie: string;
}

const JIO_ATTR_RE = /([A-Za-z0-9_-]+)="([^"]*)"/g;

function parseM3u(text: string, baseUrl: string): ParsedM3uEntry[] {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const out: ParsedM3uEntry[] = [];
  let pending: Omit<ParsedM3uEntry, "url"> | null = null;
  // Directives may appear before the #EXTINF or between it and the media URL.
  let preLicenseType = "";
  let preLicenseKey = "";
  let preUserAgent = "";
  let preCookie = "";

  const attrValue = (line: string, key: string): string => {
    const m = line.match(new RegExp(`${key}="([^"]*)"`, "i"));
    return m?.[1]?.trim() ?? "";
  };

  const resetPre = () => {
    preLicenseType = "";
    preLicenseKey = "";
    preUserAgent = "";
    preCookie = "";
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (line.startsWith("#EXTINF")) {
      const comma = line.lastIndexOf(",");
      const name = comma >= 0 ? line.slice(comma + 1).trim() : "";
      if (!name) continue;
      const head = line.slice(0, comma);
      const attrs: Record<string, string> = {};
      for (const m of head.matchAll(JIO_ATTR_RE)) attrs[m[1]!.toLowerCase()] = m[2]!.trim();
      pending = {
        ...{
          name,
          tvgId: attrs["tvg-id"] || attrs["tvg-chno"] || attrs["channel-id"] || "",
          logo: attrs["tvg-logo"] || "",
          group: attrs["group-title"] || "",
        },
        ...{ licenseType: preLicenseType, licenseKey: preLicenseKey, userAgent: preUserAgent, cookie: preCookie },
      };
      resetPre();

      // Directives between the #EXTINF and the media URL override the ones above it.
      let j = i + 1;
      for (; j < lines.length; j++) {
        const l = lines[j]!;
        if (l.startsWith("#EXTINF")) break;
        if (!l.startsWith("#")) break;
        const type = l.match(/^#KODIPROP:inputstream\.adaptive\.license_type=(\S+)/i);
        const key = l.match(/^#KODIPROP:inputstream\.adaptive\.license_key=(\S+)/i);
        const ua = l.match(/^#EXTVLCOPT:http-user-agent=(\S+)/i);
        const cookie = l.match(/^#EXTHTTP:\{"cookie":"([^"]*)"\}/i);
        if (type) pending!.licenseType = type[1]!;
        if (key) pending!.licenseKey = key[1]!;
        if (ua) pending!.userAgent = ua[1]!;
        if (cookie) pending!.cookie = cookie[1]!;
      }
      i = j - 1;
      continue;
    }

    if (line.startsWith("#")) {
      const type = line.match(/^#KODIPROP:inputstream\.adaptive\.license_type=(\S+)/i);
      const key = line.match(/^#KODIPROP:inputstream\.adaptive\.license_key=(\S+)/i);
      const ua = line.match(/^#EXTVLCOPT:http-user-agent=(\S+)/i);
      const cookie = line.match(/^#EXTHTTP:\{"cookie":"([^"]*)"\}/i);
      if (type) preLicenseType = type[1]!;
      if (key) preLicenseKey = key[1]!;
      if (ua) preUserAgent = ua[1]!;
      if (cookie) preCookie = cookie[1]!;
      continue;
    }

    // A media URL. It needs a pending entry; some lists carry the id only in `?id=`.
    let abs = "";
    try {
      abs = new URL(line, baseUrl).toString();
    } catch {
      abs = line;
    }
    if (pending && /^https?:\/\//i.test(abs)) {
      const idFromUrl = abs.match(/[?&]id=(\d{1,10})/)?.[1] ?? "";
      const tvgId = pending.tvgId || idFromUrl;
      if (tvgId || pending.name) {
        out.push({ ...pending, tvgId, url: abs });
      }
    }
    pending = null;
    resetPre();
  }
  return out;
}

/** "dash", "hls" or "mp4" from the media URL, never from the page. */
function jioMediaType(url: string): "hls" | "mp4" | "dash" {
  const ext = url.split("?")[0]!.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "m3u8") return "hls";
  if (ext === "mp4") return "mp4";
  return "dash";
}

/** The headers an IPTV player sends: the playlist's own UA, no Origin/Referer (the CDN 451s on those). */
function jioMediaHeaders(entry: ParsedM3uEntry, includeCookie: boolean): Record<string, string> {
  const h: Record<string, string> = { "User-Agent": entry.userAgent || JIO_UA_OVERRIDE };
  if (includeCookie && entry.cookie) h["Cookie"] = entry.cookie;
  return h;
}

/** A real manifest, not an HTML error page or a login wall that happens to return 200. */
function isManifest(type: "hls" | "mp4" | "dash", body: string): boolean {
  const head = body.slice(0, 2048);
  if (type === "hls") return head.trimStart().startsWith("#EXTM3U");
  if (type === "mp4") return false;
  return /<MPD/i.test(head) || /urn:mpeg:dash/i.test(head);
}

interface ClearKeyPair {
  kid: string;
  k: string;
}

/**
 * The provider's ClearKey document: `{"keys":[{"kty":"oct","k":"…","kid":"…"}]}`.
 * Plain `kid:key` pairs and `{"keys":{"kid":"key"}}` are accepted too.
 */
function parseClearKeys(body: string): ClearKeyPair[] {
  if (!body.trim() || body.length > 64 * 1024) return [];
  const out: ClearKeyPair[] = [];
  const normalised = (v: string | undefined | null): string | null => {
    const t = (v ?? "").trim();
    if (/^[0-9a-fA-F]{32}$/.test(t)) return t;
    if (/^[A-Za-z0-9_-]{16,88}$/.test(t)) return t;
    return null;
  };
  const push = (kid: unknown, key: unknown) => {
    const id = normalised(typeof kid === "string" ? kid : "");
    const k = normalised(typeof key === "string" ? key : "");
    if (id && k) out.push({ kid: id, k });
  };

  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const keys = parsed["keys"];
    if (Array.isArray(keys)) {
      for (const item of keys.slice(0, 8)) {
        if (!item || typeof item !== "object") continue;
        const rec = item as Record<string, unknown>;
        push(rec["kid"] ?? rec["keyId"], rec["k"] ?? rec["key"]);
      }
    } else if (keys && typeof keys === "object") {
      for (const [kid, k] of Object.entries(keys as Record<string, unknown>)) push(kid, k);
    }
    if (out.length === 0) push(parsed["kid"], parsed["k"]);
    return out;
  } catch {
    // Not JSON: fall back to plain kid:key tokens.
  }
  for (const token of body.trim().split(/[,;\s]+/)) {
    if (!token.includes(":")) continue;
    push(token.slice(0, token.indexOf(":")), token.slice(token.indexOf(":") + 1));
  }
  return out;
}

/** `cenc:default_KID` values from an MPD, normalised to base64url (the form ClearKey uses). */
/**
 * Reconcile a key document with the manifest's declared key ids.
 *
 * If none of the advertised ids appear in the manifest and there is exactly one key, the
 * key is relabelled onto each id the manifest declares. Fewer than one, or several
 * disagreeing keys, are left alone: guessing there would decrypt the wrong track.
 */
function matchClearKeys(keys: ClearKeyPair[], kids: string[]): ClearKeyPair[] {
  if (keys.length === 0 || kids.length === 0) return keys;
  if (keys.some((k) => kids.includes(k.kid))) return keys;
  if (keys.length !== 1) return keys;
  const only = keys[0]!.k;
  return kids.map((kid) => ({ kid, k: only }));
}

function defaultKids(mpd: string): string[] {
  const out = new Set<string>();
  const re = /cenc:default_KID\s*=\s*["']([0-9a-fA-F-]{32,36})["']/g;
  for (const m of mpd.matchAll(re)) {
    const hex = m[1]!.replace(/-/g, "");
    if (hex.length !== 32) continue;
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    out.add(toBase64Url(bytes));
  }
  return [...out];
}

/** The key endpoint the playlist advertises, when it is HTTPS on the playlist's own host. */
function jioLicenseUrl(entry: ParsedM3uEntry, siteHost: string): string | null {
  const raw = (entry.licenseKey || "").trim();
  if (!/^https:\/\//i.test(raw)) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || !u.hostname) return null;
    if (u.hostname.toLowerCase() !== siteHost.toLowerCase()) return null;
    return raw;
  } catch {
    return null;
  }
}

const JIO_UA_OVERRIDE = "@allinone_reborn";
const JIO_SITE = "https://allinonereborn2.online";
const jioKeyCache = new Map<string, { keys: ClearKeyPair[]; until: number }>();

/** Reads the provider's key document. Keys stay in memory and are never written to disk. */
async function jioKeysFor(entry: ParsedM3uEntry, siteHost: string): Promise<ClearKeyPair[]> {
  // Inline `kid:key` needs no request.
  const inline: ClearKeyPair[] = [];
  if (entry.licenseKey && !/^https?:\/\//i.test(entry.licenseKey)) {
    for (const pair of entry.licenseKey.split(",")) {
      const i = pair.indexOf(":");
      if (i > 0) inline.push({ kid: pair.slice(0, i).trim(), k: pair.slice(i + 1).trim() });
    }
  }
  const url = jioLicenseUrl(entry, siteHost);
  if (!url) return inline;

  const cached = jioKeyCache.get(url);
  if (cached && cached.until > Date.now()) return [...inline, ...cached.keys];

  try {
    // Bounded: a key document that never answers used to stall the entire playlist
    // build, leaving the guide on "Loading…" with no way out.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    let body = "";
    try {
      const res = await fetch(url, {
        headers: {
          Origin: JIO_SITE,
          Referer: `${JIO_SITE}/`,
          Accept: "application/json",
          "User-Agent": JIO_UA_OVERRIDE,
        },
        signal: ctrl.signal,
      });
      if (!res.ok) return inline;
      body = await res.text();
    } finally {
      clearTimeout(timer);
    }
    const keys = parseClearKeys(body);
    if (keys.length) jioKeyCache.set(url, { keys, until: Date.now() + 10 * 60 * 1000 });
    return [...inline, ...keys];
  } catch {
    return inline;
  }
}

let jioPlaylistShape = 0;

const jioCache: { items: LiveChannelItem[]; fetchedAt: number; error: string | null } = {
  items: [],
  fetchedAt: 0,
  error: null,
};

async function fetchJioCatalogue(cfg: GatewayConfig): Promise<LiveChannelItem[]> {
  // The front door refuses a scriptless client (HTTP 415) when the request looks like a
  // media player. Try the shapes the Android app tries, cheapest first, and keep the one
  // that answers for the rest of this process.
  const shapes: Array<Record<string, string>> = [
    { Accept: "*/*" },
    { Accept: "*/*", "User-Agent": JIO_UA_OVERRIDE },
    { Accept: "application/vnd.apple.mpegurl, application/x-mpegurl" },
    { Origin: JIO_SITE, Referer: `${JIO_SITE}/`, Accept: "*/*" },
    {
      Origin: JIO_SITE,
      Referer: `${JIO_SITE}/`,
      Accept: "application/vnd.apple.mpegurl, application/x-mpegurl",
      "User-Agent": JIO_UA_OVERRIDE,
    },
  ];

  let text = "";
  let status = 0;
  let networkError = "";
  const order = [jioPlaylistShape, ...shapes.map((_, i) => i)];
  for (const idx of order) {
    try {
      const res = await fetch(cfg.jioPlaylistUrl, { headers: shapes[idx]! });
      if (!res.ok) {
        status = res.status;
        continue;
      }
      const body = await res.text();
      if (!body.trimStart().startsWith("#EXTM3U")) continue;
      text = body;
      jioPlaylistShape = idx!;
      break;
    } catch (e) {
      networkError = e instanceof Error ? e.message : String(e);
    }
  }

  if (!text) {
    if (status) throw new Error(`Backup playlist returned HTTP ${status}`);
    throw new Error(`Backup playlist unreachable (${networkError || "no response"})`);
  }

  const entries = parseM3u(text, cfg.jioPlaylistUrl);
  if (entries.length === 0) throw new Error("Backup playlist listed no channels");

  const siteHost = (() => {
    try {
      return new URL(cfg.jioPlaylistUrl).hostname;
    } catch {
      return "allinonereborn2.online";
    }
  })();

  // Key documents are fetched concurrently. Doing this one channel at a time meant the
  // catalogue took as long as the sum of every key round-trip -- measured at 6s for 60
  // channels, so a real playlist of a few hundred sat on "Loading…" for half a minute.
  const wantsDrm = (e: ParsedM3uEntry) => Boolean(e.licenseType.toLowerCase() === "clearkey" || e.licenseKey);

  const keyStore = new Map<number, ClearKeyPair[]>();
  const drmIndexes = entries.map((e, i) => (wantsDrm(e) ? i : -1)).filter((i) => i >= 0);
  const CONCURRENCY = 8;
  for (let start = 0; start < drmIndexes.length; start += CONCURRENCY) {
    const batch = drmIndexes.slice(start, start + CONCURRENCY);
    const settled = await Promise.all(
      batch.map(async (i) => {
        try {
          return [i, await jioKeysFor(entries[i]!, siteHost)] as const;
        } catch {
          // A single unreachable key document must not take the playlist down with it.
          return [i, [] as ClearKeyPair[]] as const;
        }
      }),
    );
    for (const [i, keys] of settled) keyStore.set(i, keys);
  }

  const items: LiveChannelItem[] = [];
  for (const [i, e] of entries.entries()) {
    const mediaType = jioMediaType(e.url);
    // Only DRM-protected entries need a key round-trip; plain HLS does not.
    let drm: LiveChannelItem["drm"];
    if (wantsDrm(e)) {
      const keys = keyStore.get(i) ?? [];
      const licenseUrl = jioLicenseUrl(e, siteHost) ?? undefined;
      // Kept even with zero keys: the player can pull the MPD's default_KID itself.
      drm = { type: "clearkey", keys, ...(licenseUrl ? { licenseUrl } : {}) };
    }
    items.push({
      // Stable id: the playlist's own channel number, else its position.
      id: `jio:${e.tvgId || i}`,
      rawId: e.tvgId || String(i),
      source: "jio" as const,
      name: e.name,
      category: e.group || "JioTV",
      logo: e.logo,
      cmd: e.url,
      mediaType,
      userAgent: e.userAgent || JIO_UA_OVERRIDE,
      ...(e.cookie ? { cookie: e.cookie } : {}),
      ...(drm ? { drm } : {}),
    });
  }
  return items;
}

async function loadJioCached(cfg: GatewayConfig, force = false): Promise<LiveChannelItem[]> {
  if (!force && jioCache.items.length > 0 && Date.now() - jioCache.fetchedAt < CATALOGUE_TTL_MS) {
    return jioCache.items;
  }
  try {
    const live = await fetchJioCatalogue(cfg);
    jioCache.items = live;
    jioCache.fetchedAt = Date.now();
    jioCache.error = null;
    return live;
  } catch (e) {
    jioCache.error = e instanceof Error ? e.message : String(e);
    return jioCache.items;
  }
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
  if (s === "jio") return loadJioCached(cfg, force);
  if (s === "all") {
    const [m, j] = await Promise.all([loadMaxtvCached(cfg, force), loadJioCached(cfg, force)]);
    // The seed rows are placeholders that cannot play, so they must never pad out a
    // combined list: "Both" would otherwise show 24 dead entries above the live ones,
    // and the top of the guide would be the part that does not work.
    const live = memCache.maxtv.usingSeed ? [] : m;
    const combined = [...live, ...j];
    return combined.length > 0 ? combined : m;
  }
  // The default path is "maxTV, with the backup playlist behind it".
  // A portal that answered with a real catalogue wins; anything else falls through
  // to JioTV so a viewer still gets channels that actually play.
  const maxtv = await loadMaxtvCached(cfg, force);
  if (!memCache.maxtv.usingSeed && maxtv.length > 0) return maxtv;
  const jio = await loadJioCached(cfg, force);
  return jio.length > 0 ? jio : maxtv;
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

async function signSegmentToken(
  url: string,
  mode: "mag" | "xtream",
  secret: string,
  headers?: { ua?: string; ck?: string },
): Promise<string> {
  const enc = new TextEncoder();
  const signed: Record<string, unknown> = { u: url, m: mode };
  // Child requests (segments, sub-manifests) must keep the playlist's own UA and
  // cookie. Without them the Jio CDN answers 451 to the bare browser request.
  if (headers?.ua) signed["h"] = { ua: headers.ua, ...(headers.ck ? { ck: headers.ck } : {}) };
  const payload = toBase64Url(enc.encode(JSON.stringify(signed)));
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  const sig = toBase64Url(new Uint8Array(sigBuf)).slice(0, 22);
  return `${payload}.${sig}`;
}

interface VerifiedSegmentToken {
  u: string;
  m: "mag" | "xtream";
  ua?: string;
  ck?: string;
}

async function verifySegmentToken(token: string, secret: string): Promise<VerifiedSegmentToken | null> {
  const [payload, sig] = String(token || "").split(".");
  if (!payload || !sig) return null;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  const expected = toBase64Url(new Uint8Array(sigBuf)).slice(0, 22);
  if (sig !== expected) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as {
      u?: string;
      m?: "mag" | "xtream";
      h?: { ua?: string; ck?: string };
    };
    if (!parsed?.u || !/^https?:\/\//i.test(parsed.u)) return null;
    return {
      u: parsed.u,
      m: parsed.m === "xtream" ? "xtream" : "mag",
      ...(parsed.h?.ua ? { ua: parsed.h.ua } : {}),
      ...(parsed.h?.ck ? { ck: parsed.h.ck } : {}),
    };
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
  headers?: { ua?: string; ck?: string },
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
    const tok = await signSegmentToken(abs, mode, secret, headers);
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

function overrideHeadersFromToken(v: VerifiedSegmentToken): Record<string, string> | undefined {
  if (!v.ua) return undefined;
  return { "User-Agent": v.ua, ...(v.ck ? { Cookie: v.ck } : {}) };
}

/** The UA/cookie pair to seal into child tokens, derived from the upstream request. */
function tokenHeadersFrom(overrideHeaders?: Record<string, string>): { ua?: string; ck?: string } | undefined {
  const ua = overrideHeaders?.["User-Agent"];
  if (!ua) return undefined;
  const ck = overrideHeaders?.["Cookie"];
  return ck ? { ua, ck } : { ua };
}

/**
 * DASH manifests need the same treatment as HLS playlists: an absolute BaseURL or
 * SegmentTemplate points the browser straight at the CDN, where it arrives with no
 * User-Agent and no CORS grant, so every segment is refused. Rewrite those references
 * onto our signed segment proxy.
 *
 * The signature covers a *directory*, never a file name, so DASH template tokens
 * ($Number$, $RepresentationID$, $Time$, $Bandwidth$) are expanded by the player and
 * survive intact in the path appended after it.
 */
async function rewriteDashManifestWeb(
  mpdText: string,
  manifestUrl: string,
  mode: "mag" | "xtream",
  publicOrigin: string,
  secret: string,
  headers?: { ua?: string; ck?: string },
): Promise<string> {
  const resolve = (raw: string): URL | null => {
    try {
      return new URL(raw, manifestUrl);
    } catch {
      return null;
    }
  };

  /** An absolute directory -> a proxied directory whose token carries its UA/cookie. */
  const proxyDir = async (dirUrl: string): Promise<string> => {
    const tok = await signSegmentToken(dirUrl, mode, secret, headers);
    return `${publicOrigin}/api/live/dashseg/${tok}/`;
  };

  /** An absolute file reference -> proxied path, keeping template tokens and query. */
  const proxyFile = async (url: URL): Promise<string> => {
    const cut = url.pathname.lastIndexOf("/");
    const dir = `${url.origin}${url.pathname.slice(0, cut + 1)}`;
    const file = url.pathname.slice(cut + 1);
    return `${await proxyDir(dir)}${file}${url.search}`;
  };

  let out = mpdText;

  // Attributes that may hold an absolute media reference. `media` and
  // `initialization` are the SegmentTemplate pair; the rest are SegmentBase/List.
  // Rewrite EVERY occurrence, and build replacements with a function.
  //
  // String.replace with a string pattern replaces only the first match, so when two
  // Representations share one absolute media template -- which is normal in DASH -- every
  // copy after the first kept pointing at the CDN and was fetched bare, where it is
  // refused. A function replacement also stops `$` in a token or file name being read as
  // a `$&` backreference.
  const attrs: Array<{ from: string; to: string }> = [];
  const seen = new Set<string>();
  for (const m of out.matchAll(/\b(media|initialization|sourceURL|index)="(https?:\/\/[^"]*)"/gi)) {
    const resolved = resolve(m[2]!);
    if (!resolved) continue;
    const key = `${m[1]!}=${m[2]!}`;
    if (seen.has(key)) continue;
    seen.add(key);
    attrs.push({ from: m[0]!, to: `${m[1]!}="${await proxyFile(resolved)}"` });
  }
  for (const { from, to } of attrs) {
    out = out.split(from).join(to);
  }

  // Every BaseURL, wherever it sits, must land on our proxy. Nested BaseURLs then
  // concatenate correctly because each one is rewritten to a fully-qualified URL.
  if (/<BaseURL>/i.test(out)) {
    // One pass, every tag. Precompute each unique target first because the rewrite is
    // async, then swap them all in a single synchronous replace-with-callback. Doing it
    // one match at a time with a string pattern silently skipped every repeat.
    const proxied = new Map<string, string>();
    for (const m of out.matchAll(/<BaseURL>\s*([\s\S]*?)\s*<\/BaseURL>/gi)) {
      const raw = m[1]!;
      if (proxied.has(raw)) continue;
      const resolved = resolve(raw);
      if (!resolved) continue;
      // A BaseURL without a trailing slash is a file-name *prefix*, not a directory.
      const isDir = resolved.pathname.endsWith("/");
      const cut = resolved.pathname.lastIndexOf("/");
      const suffix = isDir ? "" : resolved.pathname.slice(cut + 1);
      const dir = `${resolved.origin}${resolved.pathname.slice(0, cut + 1)}`;
      proxied.set(raw, `${await proxyDir(dir)}${suffix}`);
    }
    out = out.replace(/(<BaseURL>)\s*([\s\S]*?)\s*(<\/BaseURL>)/gi, (whole, open, raw) => {
      const target = proxied.get(raw);
      return target ? `${open}${target}</BaseURL>` : whole;
    });
  } else {
    // With no BaseURL the player resolves against the manifest URL, i.e. our
    // /api/live/stream/... route, where no segments exist. Pin it to the real one.
    const self = resolve(manifestUrl);
    if (self) {
      const cut = self.pathname.lastIndexOf("/");
      const dir = `${self.origin}${self.pathname.slice(0, cut + 1)}`;
      const proxied = await proxyDir(dir);
      out = out.replace(/<MPD\b[^>]*>/i, (tag) => `${tag}<BaseURL>${proxied}</BaseURL>`);
    }
  }

  return out;
}

function corsEmbedHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type, Accept, Origin",
    "Access-Control-Expose-Headers": "Content-Type, X-Stream-Container, X-Clear-Keys",
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

/**
 * Open a JioTV media URL the way the v.4.9 app does, trying each header shape in turn.
 *
 * The playlist's `#EXTHTTP` cookie is a *coarse* token minted for the whole site, while
 * the address behind the redirect carries one minted for that single channel and path.
 * The CDN disagrees about which it wants per channel, and answers 450/451/403 to the
 * wrong one. The app therefore sends both and lets the CDN choose; a single attempt is
 * what made every channel fail here with "Upstream stream returned HTTP 450".
 */
async function fetchJioMedia(
  url: string,
  entry: { userAgent?: string | undefined; cookie?: string | undefined },
): Promise<{ res: Response; finalUrl: string } | null> {
  const ua = entry.userAgent || JIO_UA_OVERRIDE;
  const attempts: Array<Record<string, string>> = [
    // What an IPTV player sends, and the only shape that gets past the redirector.
    { "User-Agent": ua, ...(entry.cookie ? { Cookie: entry.cookie } : {}) },
    // The CDN may mint a fresh token on each redirect and reject the coarse one.
    { "User-Agent": ua },
    // Last: the playlist's browser-style identity, for a host that wants it.
    { "User-Agent": ua, ...(entry.cookie ? { Cookie: entry.cookie } : {}), Origin: JIO_SITE, Referer: `${JIO_SITE}/` },
  ];

  let last: { res: Response; finalUrl: string } | null = null;
  for (const headers of attempts) {
    let currentUrl = url;
    try {
      // Follow the redirect chain by hand so the signed CDN address is kept: the
      // redirector re-mints the __hdnea__ token, and the bare URL is a stale one.
      for (let hop = 0; hop < 6; hop++) {
        const res = await fetch(currentUrl, { headers: { Accept: "*/*", ...headers }, redirect: "manual" });
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get("location");
          if (!loc) return { res, finalUrl: currentUrl };
          currentUrl = new URL(loc, currentUrl).toString();
          continue;
        }
        if (res.ok) return { res, finalUrl: currentUrl };
        last = { res, finalUrl: currentUrl };
        break;
      }
    } catch {
      // Network-level failure: try the next shape.
    }
  }
  return last;
}

async function proxyMediaStream(
  upstreamUrl: string,
  mode: "mag" | "xtream",
  publicOrigin: string,
  secret: string,
  overrideHeaders?: Record<string, string>,
  clearKeys?: ClearKeyPair[],
  range?: string | null,
): Promise<Response> {
  const headers: Record<string, string> = overrideHeaders
    ? { Accept: "*/*", ...overrideHeaders }
    : mode === "xtream"
      ? { "User-Agent": XTREAM_USER_AGENT, Accept: "*/*", "Icy-MetaData": "1" }
      : { "User-Agent": MAG_USER_AGENT, "X-User-Agent": MAG_DEVICE_UA, Accept: "*/*", "Icy-MetaData": "1" };

  // Shaka asks for byte ranges on MP4 segments. Dropping the range silently returned the
  // whole file, which some CDNs answer with 405 because the request is malformed for a
  // ranged resource.
  if (range) headers["Range"] = range;

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
  const headText = new TextDecoder().decode(first.value.subarray(0, 64)).trimStart();
  const pathLower = currentUrl.split("?")[0]!.toLowerCase();
  const isHls = ctype.includes("mpegurl") || pathLower.endsWith(".m3u8") || headText.startsWith("#EXTM3U");
  const isDash = ctype.includes("dash+xml") || pathLower.endsWith(".mpd") || /^<\?xml|^<MPD/i.test(headText);

  if (isDash) {
    // An MPD is small; buffer it and hand it back whole so the player can read it.
    const chunks: Uint8Array[] = [first.value];
    let total = first.value.byteLength;
    while (total < 4 * 1024 * 1024) {
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
    const mpdText = new TextDecoder().decode(merged);
    // A ClearKey licence must name the key id the manifest actually uses. When the key
    // document and the MPD disagree, the session decrypts nothing and the viewer sees a
    // black screen with no error at all. A single advertised key is therefore relabelled
    // onto the manifest's key id rather than dropped, exactly as the v.4.9 app does.
    const matched = matchClearKeys(clearKeys ?? [], defaultKids(mpdText));
    const keyHeader = matched.length
      ? { "X-Clear-Keys": matched.map((k) => `${k.kid}:${k.k}`).join(",") }
      : {};
    // Hand over a manifest whose every reference points back at us. Untouched, the
    // player would walk straight out to the CDN and lose the UA that keeps it alive.
    const rewritten = await rewriteDashManifestWeb(
      mpdText,
      currentUrl,
      mode,
      publicOrigin,
      secret,
      tokenHeadersFrom(overrideHeaders),
    );
    return new Response(rewritten, {
      status: 200,
      headers: corsEmbedHeaders({
        "Content-Type": "application/dash+xml; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Stream-Container": "dash",
        ...keyHeader,
      }),
    });
  }

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
    const rewritten = await rewriteHlsManifestWeb(
      manifestText,
      currentUrl,
      mode,
      publicOrigin,
      secret,
      tokenHeadersFrom(overrideHeaders),
    );
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
  <script src="/vendor/shaka-player.compiled.js"></script>
  <script>
    const ch = ${boot};
    const v = document.getElementById("v"), ov = document.getElementById("ov"), st = document.getElementById("st"), rt = document.getElementById("rt"), au = document.getElementById("au"), mu = document.getElementById("mu"), pl = document.getElementById("pl");
    document.getElementById("nm").textContent = ch.name;
    if (new URLSearchParams(location.search).get("muted") === "1") { v.muted = true; mu.textContent = "Unmute"; }
    let mp = null, hp = null, sp = null;
    function clean() {
      if (mp) { try { mp.unload(); mp.detachMediaElement(); mp.destroy(); } catch {} mp = null; }
      if (hp) { try { hp.destroy(); } catch {} hp = null; }
      if (sp) { try { sp.destroy(); } catch {} sp = null; }
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
    function hexKey(v) {
      v = String(v == null ? "" : v).trim();
      if (!v) return null;
      if (/^[0-9a-fA-F]{32}$/.test(v)) return v.toLowerCase();
      var n = v.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
      if (!/^[A-Za-z0-9+/]+$/.test(n)) return null;
      var p = n + "===".slice((n.length + 3) % 4);
      try {
        var b = atob(p);
        if (b.length !== 16) return null;
        var h = "";
        for (var i = 0; i < b.length; i++) h += b.charCodeAt(i).toString(16).padStart(2, "0");
        return h;
      } catch (e) { return null; }
    }
    function startDash(url) {
      clean();
      if (!window.shaka) { st.textContent = "DASH playback engine did not load."; rt.style.display = "inline-block"; ov.classList.remove("hide"); return; }
      shaka.polyfill.installAll();
      if (!shaka.Player.isBrowserSupported()) { st.textContent = "This browser cannot play protected DASH streams."; rt.style.display = "inline-block"; ov.classList.remove("hide"); return; }
      if (shaka.log && shaka.LogLevel) shaka.log.setLevel(shaka.LogLevel.NONE);
      sp = new shaka.Player();
      var ck = {};
      ((ch.drm && ch.drm.keys) || []).forEach(function (pair) {
        var kid = hexKey(pair.kid), k = hexKey(pair.k);
        if (kid && k) ck[kid] = k;
      });
      sp.configure({
        drm: Object.keys(ck).length ? { clearKeys: ck } : {},
        streaming: { lowLatencyMode: true, rebufferingGoal: 2, bufferingGoal: 20, retryParameters: { maxAttempts: 4, baseDelay: 500, backoffFactor: 2, timeout: 20000 } },
        manifest: { retryParameters: { maxAttempts: 3, baseDelay: 500, backoffFactor: 2, timeout: 20000 } }
      });
      sp.addEventListener("error", function () {
        st.textContent = Object.keys(ck).length ? "This DRM channel was refused. Its ClearKey document may have rotated." : "This channel is DRM protected and no key was provided.";
        rt.style.display = "inline-block"; ov.classList.remove("hide");
      });
      Promise.resolve()
        .then(function () { return sp.attach(v); })
        .then(function () { return sp.load(url); })
        .then(function () {
          var langs = sp.getAudioLanguages() || [];
          if (langs.length > 1) {
            Array.prototype.forEach.call(langs, function (name, i) {
              var o = document.createElement("option");
              o.value = name; o.textContent = "Audio: " + name;
              au.appendChild(o);
            });
            var hi = langs.filter(function (l) { return /^hi/i.test(l); })[0];
            if (hi) sp.selectAudioLanguage(hi);
            au.value = sp.getAudioLanguage() || langs[0];
            au.style.display = "inline-block";
            au.onchange = function () { sp.selectAudioLanguage(au.value); };
          }
          v.play().catch(function () { v.muted = true; mu.textContent = "Unmute"; v.play().catch(function () {}); });
        })
        .catch(function () { st.textContent = "DASH playback failed to start."; rt.style.display = "inline-block"; ov.classList.remove("hide"); });
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
      armWatchdog();
      // Ask for the container the catalogue advertised. Probing ".ts" unconditionally
      // made every DASH channel look like MPEG-TS, so the embed could never play one.
      const wantDash = String(ch.container || "").toLowerCase() === "dash";
      const probeExt = wantDash ? ".mpd" : ".ts";
      const c = new AbortController(); const tm = setTimeout(() => c.abort(), 8000);
      try {
        const r = await fetch(sUrl(probeExt), { signal: c.signal }); clearTimeout(tm);
        if (!r.ok) { const j = await r.json().catch(() => ({})); c.abort(); st.textContent = j.error || ("HTTP " + r.status); rt.style.display = "inline-block"; return; }
        const kind = (r.headers.get("x-stream-container") || "").toLowerCase(); c.abort();
        if (kind === "dash") startDash(sUrl(".mpd"));
        else if (kind === "hls") startHls(sUrl(".m3u8"));
        else startTs(sUrl(".ts"), true);
      } catch { clearTimeout(tm); if (wantDash) startDash(sUrl(".mpd")); else startTs(sUrl(".ts"), true); }
    }
    // Only hide the overlay once a frame exists. An element can report "playing" with
    // videoWidth 0 when every segment is refused, which shows a silent black box.
    v.onplaying = () => {
      pl.textContent = "Pause";
      if (v.videoWidth > 0 && v.videoHeight > 0) ov.classList.add("hide");
    };
    let deadTimer = null;
    function armWatchdog() {
      clearTimeout(deadTimer);
      deadTimer = setTimeout(() => {
        if (v.videoWidth > 0 && v.videoHeight > 0) return;
        st.textContent = "The stream started but no video arrived. Segments were refused or the format is unsupported.";
        rt.style.display = "inline-block"; ov.classList.remove("hide");
      }, 15000);
    }
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
    // The extension follows the container so the player probes the right engine.
    streamUrl: `${publicOrigin}/api/live/stream/${enc}.${ch.mediaType === "dash" ? "mpd" : ch.mediaType === "hls" ? "m3u8" : "ts"}`,
    ...(ch.drm && ch.drm.keys.length ? { drm: { type: "clearkey" as const, keys: ch.drm.keys } } : {}),
    ...(ch.mediaType ? { container: ch.mediaType } : {}),
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

    // Report what is actually being served. A seed row can never masquerade as a working
    // catalogue, and when the backup playlist is carrying the list that is stated plainly.
    const usingSeed = filtered.length > 0 && filtered.every((c) => String(c.cmd || "").startsWith("seed://"));
    const hasJio = filtered.some((c) => c.source === "jio");
    const hasMaxtv = filtered.some((c) => c.source === "maxtv");

    const served: "maxtv" | "jio" | "starshare" | "mixed" | "seed" =
      source === "starshare"
        ? "starshare"
        : usingSeed
          ? "seed"
          : source === "jio"
            ? "jio"
            : hasJio && hasMaxtv
              ? "mixed"
              : hasJio
                ? "jio"
                : "maxtv";

    const portalError = usingSeed ? memCache.maxtv.error : null;

    return jsonResponse(200, {
      ok: true,
      source,
      servedBy: served,
      filter,
      totalMatching: filtered.length,
      usingPreviewSeed: usingSeed,
      portalError,
      portalEndpoint: memCache.maxtv.endpoint,
      backupError: jioCache.error,
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

  if (path === "/api/live/resolve") {
    const id = url.searchParams.get("id") || "";
    if (!id) return jsonResponse(400, { ok: false, error: "id is required" });
    const pool = await getChannelsBySource(cfg, "all", false);
    const ch = pool.find((c) => c.id === id || c.rawId === id);
    if (!ch) return jsonResponse(404, { ok: false, error: "Channel not found" });

    if (ch.source === "jio") {
      return jsonResponse(200, {
        ok: true,
        channel: ch.name,
        source: "jio",
        container: ch.mediaType ?? "dash",
        upstreamUrl: ch.cmd ?? "",
        clearkeys: ch.drm?.keys ?? [],
        userAgent: ch.userAgent ?? JIO_UA_OVERRIDE,
        hasCookie: Boolean(ch.cookie),
        proxyUrl: `${publicOrigin}/api/live/stream/${encodeURIComponent(ch.id)}.${ch.mediaType === "hls" ? "m3u8" : ch.mediaType === "mp4" ? "ts" : "mpd"}`,
      });
    }

    try {
      const resolved = await resolveMaxtvLink(cfg, ch.cmd || "");
      return jsonResponse(200, {
        ok: true,
        channel: ch.name,
        source: ch.source,
        container: "mpegts",
        upstreamUrl: resolved,
        proxyUrl: `${publicOrigin}/api/live/stream/${encodeURIComponent(ch.id)}.ts`,
      });
    } catch (e) {
      return jsonResponse(502, { ok: false, error: e instanceof Error ? e.message : "Failed to resolve link" });
    }
  }

  if (path === "/api/live/segment") {
    const tok = url.searchParams.get("t") || "";
    const verified = await verifySegmentToken(tok, cfg.proxySecret);
    if (!verified) return jsonResponse(403, { ok: false, error: "Invalid segment token" });
    return proxyMediaStream(
      verified.u,
      verified.m,
      publicOrigin,
      cfg.proxySecret,
      overrideHeadersFromToken(verified),
      undefined,
      request.headers.get("range"),
    );
  }

  // DASH segment/initialisation fetches. The tokenised part is the directory, so the
  // path after it is whatever SegmentTemplate the manifest used, already expanded by
  // the player ($Number$, $RepresentationID$, $Time$ and nested folders all survive).
  /**
   * Walk a channel's DASH manifest the way the player will, from the first reference
   * onward, and report what each one actually returns. Without this a failure is only
   * ever "segments refused", with no way to see which URL was refused or why.
   */
  if (path === "/api/live/diagnose") {
    const id = url.searchParams.get("id") || "";
    const pool = await getChannelsBySource(cfg, "all", false);
    const ch = pool.find((c) => c.id === id || c.rawId === id);
    if (!ch) return jsonResponse(404, { ok: false, error: "Channel not found" });

    const probe = async (raw: string, headers: Record<string, string>) => {
      try {
        const res = await fetch(raw, { headers, redirect: "manual" });
        const text = res.status === 200 ? await res.text().catch(() => "") : "";
        return {
          url: raw,
          status: res.status,
          location: res.headers.get("location") ?? null,
          contentType: res.headers.get("content-type") ?? null,
          isManifest: /#EXTM3U|<MPD/i.test(text.slice(0, 2048)),
        };
      } catch (e) {
        return { url: raw, status: 0, error: e instanceof Error ? e.message : String(e) };
      }
    };

    const ua = ch.userAgent || JIO_UA_OVERRIDE;
    const headers: Record<string, string> = {
      "User-Agent": ua,
      ...(ch.cookie ? { Cookie: ch.cookie } : {}),
      Accept: "*/*",
    };
    const opened = ch.cmd ? await probe(ch.cmd, headers) : null;
    const finalUrl = opened?.location ?? ch.cmd ?? "";

    let references: Array<{ kind: string; url: string; status: number | null }> = [];
    if (ch.mediaType === "dash" && finalUrl) {
      const body = await fetch(finalUrl, { headers, redirect: "follow" })
        .then((r) => (r.ok ? r.text() : ""))
        .catch(() => "");
      const base = finalUrl.slice(0, finalUrl.lastIndexOf("/") + 1);
      for (const m of body.matchAll(/<(?:BaseURL|SegmentTemplate|SegmentURL)[^>]*>/gi)) {
        const tag = m[0];
        const attr = /(media|initialization|sourceURL|index|href)="([^"]+)"/i.exec(tag);
        if (!attr?.[2]) continue;
        let abs: string;
        try {
          abs = new URL(attr[2].replace(/\$(Number|RepresentationID|Time|Bandwidth)\$[^/]*$/, "1"), base).toString();
        } catch {
          continue;
        }
        const r = await fetch(abs, { headers: { ...headers, Range: "bytes=0-1023" }, redirect: "manual" }).catch(() => null);
        references.push({ kind: attr[1]!, url: abs, status: r ? r.status : 0 });
      }
    }

    return jsonResponse(200, {
      ok: true,
      channel: { id: ch.id, name: ch.name, source: ch.source, mediaType: ch.mediaType ?? null },
      hasCookie: Boolean(ch.cookie),
      advertisedUrl: ch.cmd ?? null,
      firstResponse: opened,
      resolvedUrl: finalUrl,
      references,
      hint:
        references.length === 0
          ? "No DASH references were found. The manifest may be HLS, or the CDN refused the manifest fetch."
          : references.every((r) => r.status === 200 || r.status === 206)
            ? "Every reference answered. Playback should work."
            : "At least one reference was refused; the statuses above say which and where.",
    });
  }

  if (path.startsWith("/api/live/dashseg/")) {
    const rest = path.slice("/api/live/dashseg/".length);
    const slash = rest.indexOf("/");
    if (slash < 0) return jsonResponse(400, { ok: false, error: "Malformed DASH segment path" });
    const tok = decodeURIComponent(rest.slice(0, slash));
    const file = rest.slice(slash + 1);
    const verified = await verifySegmentToken(tok, cfg.proxySecret);
    if (!verified) return jsonResponse(403, { ok: false, error: "Invalid segment token" });
    const target = new URL(file, verified.u.endsWith("/") ? verified.u : `${verified.u}/`);
    if (url.search) target.search = url.search;
    return proxyMediaStream(
      target.toString(),
      verified.m,
      publicOrigin,
      cfg.proxySecret,
      overrideHeadersFromToken(verified),
      undefined,
      request.headers.get("range"),
    );
  }

  if (path.startsWith("/api/live/stream/")) {
    const rawId = decodeURIComponent(path.slice("/api/live/stream/".length)).replace(/\.(?:ts|m3u8|mpd)$/i, "");
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

    // JioTV backup entries carry their own media URL, so they need no portal round-trip.
    if (ch.source === "jio") {
      if (!ch.cmd) return jsonResponse(503, { ok: false, error: "This backup channel has no stream URL" });
      try {
        const opened = await fetchJioMedia(ch.cmd, { userAgent: ch.userAgent, cookie: ch.cookie });
        if (!opened) {
          return jsonResponse(502, { ok: false, error: "The JioTV CDN did not answer this channel" });
        }
        // Hand the *final* address to the proxy: it is the one carrying the token the
        // redirector just minted for this channel, so segments and the manifest agree.
        return await proxyMediaStream(
          opened.finalUrl,
          "xtream",
          publicOrigin,
          cfg.proxySecret,
          {
            "User-Agent": ch.userAgent || JIO_UA_OVERRIDE,
            ...(ch.cookie ? { Cookie: ch.cookie } : {}),
          },
          ch.drm?.keys,
        );
      } catch (e) {
        return jsonResponse(502, { ok: false, error: e instanceof Error ? e.message : "Backup stream failed" });
      }
    }

    if (String(ch.cmd || "").startsWith("seed://")) {
      return jsonResponse(503, {
        ok: false,
        error: "No live source is reachable. maxTV did not answer and the backup playlist is unavailable.",
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
