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
 *   deviceId  the long hex device id that goes with the serial.
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
 * `tv.fusion4k.cc` is a plain Stalker panel whose API is *one level up* from the web-client
 * address written on the seller's card:
 *
 *   `…/stalker_portal/server/load.php`  -> 200, issues a token
 *   `…/stalker_portal/c/server/load.php` -> 404 "Not Found"
 *
 * Both are tried, in that order, so the card's address is still the right thing to paste here.
 *
 * ## The spare
 *
 * The account this build replaced (`new.maxtv.be`, `00:1A:79:EE:03:9F`) is kept in the gateway as
 * a second identity: a whole device, with its own serial and device id. It is only asked after the
 * account above has been refused outright, and it is asked with *its* values -- a MAC lent another
 * account's serial is a device the panel has never billed.
 */
export const MAXTV_ACCOUNT = {
  portal: "http://tv.fusion4k.cc/stalker_portal/c/",
  mac: "00:1A:79:F5:8F:95",
  serial: "99EB2A8128098",
  deviceId: "01F71B517FE629CE5FB7158273354EDF361793DC5BB6C481C4957C3356040ABA",
} as const;

/** The environment variables that override {@link MAXTV_ACCOUNT}, in the order they matter. */
export const MAXTV_ENV_VARS = ["MAXTV_PORTAL", "MAXTV_MAC", "MAXTV_SERIAL", "MAXTV_DEVICE_ID"] as const;
