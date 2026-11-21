/**
 * The maxTV account this app signs in with — **this file is the place to put it**.
 *
 * maxTV is a Stalker portal: it has no username and no password. It recognises a *device*, so a
 * subscription is four values, and all four have to belong to the same account or the panel
 * answers "not found" without saying why:
 *
 *   portal    the panel's address. `…/stalker_portal/c/` is the web client; `…/c/` is the older
 *             one. Both are tried, but the one written here is tried first.
 *   mac       the address the panel bills. `00:1A:79:…` is the usual first three bytes. Two
 *             accounts on one portal differ by this value alone, which is why it decides identity.
 *   serial    the box serial, in the panel's own format.
 *   deviceId  the long hex device id that goes with the serial (and `deviceId2` when the card
 *             prints a second one).
 *
 * ## Which wins: an environment variable or this file?
 *
 * The environment. `MAXTV_PORTAL`, `MAXTV_MAC`, `MAXTV_SERIAL` and `MAXTV_DEVICE_ID` are read
 * first, and each one overrides the matching value below on its own. That means a deployment can
 * be pointed at a different account without touching code — and `/api/live/diagnose?source=maxtv`
 * reports `configured.fromEnv` so there is never a doubt about which one answered.
 *
 * Both routes exist because the two of them fail in opposite directions: an environment variable is
 * right for a secret and wrong when the person setting it cannot find the panel that holds it, and
 * this file is right for exactly that case — it is edited in the same editor as the rest of the
 * code, and it takes effect on the next deploy like any other change.
 *
 * ## Before you put a *new* account here
 *
 * This repository can be read by anyone who can read the repository, and a MAC in it is a MAC
 * anyone can use — and a portal that sees two devices on one MAC starts refusing both. If the
 * account is not already public, set the variables instead and leave the values below as they are.
 * The ones below are already published; treat them as a working fallback, not a secret.
 *
 * ## What this subscription's panel actually answers
 *
 * `tv.fusion4k.cc` (the second subscription) is a plain Stalker panel whose API is *one level up* from the web-client
 * address written on the seller's card:
 *
 *   `…/stalker_portal/server/load.php`  -> 200, issues a token
 *   `…/stalker_portal/c/server/load.php` -> 404 "Not Found"
 *
 * Both are tried, in that order, so the card's address is still the right thing to paste here.
 *
 * ## Two subscriptions, two tabs
 *
 * Both of these are paid for and neither has expired, so both are worth watching: the original
 * maxTV panel and the reseller panel. They are *different devices on different portals* -- not one
 * account written twice -- so each keeps its own serial and device id, and each is its own tab in
 * the guide. A MAC lent another account's serial is a device the panel has never billed.
 *
 * The first entry is the default: a request without `?account=` gets it, and the environment
 * variables below override it. The others are reached by naming them (`?account=fusion4k`), which
 * is what the second tab does.
 */
export type MaxTvAccount = {
  /** What `?account=` calls it. Stable: links and cached catalogues are keyed by it. */
  id: string;
  /** What the tab says. */
  label: string;
  portal: string;
  mac: string;
  serial: string;
  deviceId: string;
  /**
   * The second device id, when the seller's card gives one.
   *
   * A card that prints two values is telling you the panel checks both. They are usually the same
   * string, and when they are not, sending the first twice is a device the panel has never billed
   * -- which it answers with "Authorization failed." and no explanation.
   */
  deviceId2?: string;
  /** The box the panel thinks it is talking to. `MAG254` unless the card says otherwise. */
  stbType?: string;
  /** The firmware fields a MAG reports; left alone unless a card names them. */
  hwVersion?: string;
  imageVersion?: string;
  apiSignature?: string;
  /** The zone the device was registered in. A zone that contradicts it is a refusal with no words. */
  timezone?: string;
};

export const MAXTV_ACCOUNTS: readonly MaxTvAccount[] = [
  {
    id: "maxtv",
    label: "maxTV",
    portal: "http://new.maxtv.be/stalker_portal/c/",
    mac: "00:1A:79:EE:03:9F",
    serial: "92180365D21FE",
    deviceId: "3610DEAFB556781F84CBC8A6AF876A8F20637668862B28DEECFACE00D67A6070",
    deviceId2: "3610DEAFB556781F84CBC8A6AF876A8F20637668862B28DEECFACE00D67A6070",
  },
  {
    id: "fusion4k",
    label: "fusion4k",
    portal: "http://tv.fusion4k.cc/stalker_portal/c/",
    mac: "00:1A:79:F5:8F:95",
    serial: "99EB2A8128098",
    deviceId: "01F71B517FE629CE5FB7158273354EDF361793DC5BB6C481C4957C3356040ABA",
    deviceId2: "01F71B517FE629CE5FB7158273354EDF361793DC5BB6C481C4957C3356040ABA",
  },
] as const;

/**
 * The playlist subscription: a plain M3U, not a portal.
 *
 * An M3U is a list of addresses, so there is no device, no handshake and no token -- and no
 * "Authorization failed." either. It is the seller's other product, and the guide gives it its own
 * tab because its channels are not the panels' channels.
 */
export const TATATV_PLAYLIST_URL = "https://allinonereborn2.online/playlist/ttv6t.m3u";

/** The default subscription: the one the environment variables override, and the one with no name. */
export const MAXTV_ACCOUNT = MAXTV_ACCOUNTS[0]!;

/** The subscription `?account=` named, or null when it names nothing we know. */
export function findMaxTvAccount(id: string | null | undefined): MaxTvAccount | null {
  const wanted = String(id ?? "").trim().toLowerCase();
  if (!wanted) return null;
  return MAXTV_ACCOUNTS.find((a) => a.id.toLowerCase() === wanted) ?? null;
}

/** The environment variables that override {@link MAXTV_ACCOUNT}, in the order they matter. */
export const MAXTV_ENV_VARS = [
  "MAXTV_PORTAL",
  "MAXTV_MAC",
  "MAXTV_SERIAL",
  "MAXTV_DEVICE_ID",
  "MAXTV_DEVICE_ID2",
  "MAXTV_STB_TYPE",
] as const;
