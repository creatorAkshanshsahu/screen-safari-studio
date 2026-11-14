import { describe, expect, it } from "vitest";

import { defaultKids, matchClearKeys } from "@/lib/live-gateway";

// "Segments arrived but produced no picture" is what a ClearKey mismatch looks like: the CDM
// accepts the licence, derives a content key that decrypts nothing, and no error is raised.
//
// These tests pin the one place we can catch it. `defaultKids` used to return base64url while
// every catalogue key is hex, so `kids.includes(k.kid)` could never be true. That made two
// things happen silently: a single-key channel was always relabelled (even when the key was
// for a different channel), and a multi-key channel was never relabelled (so its licence named
// ids the content does not use). Both end in a black frame, not an error.

const KID_HEX = "a1b2c3d4e5f61a2b3c4d5e6f7a8b9c0d";
const KID_UUID = "a1b2c3d4-e5f6-1a2b-3c4d-5e6f7a8b9c0d";
const OTHER_HEX = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";
const KEY_HEX = "00112233445566778899aabbccddeeff";

const mpd = (kids: string[]) => `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="dynamic">
  <Period><AdaptationSet>
    <ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011"
      cenc:default_KID="${kids.join('" /><ContentProtection cenc:default_KID="')}"/>
  </AdaptationSet></Period>
</MPD>`;

describe("defaultKids", () => {
  it("returns lowercase hex, the same representation the catalogue's keys use", () => {
    // The regression: this used to be base64url, which no `kid` in the codebase ever matches.
    expect(defaultKids(mpd([KID_UUID]))).toEqual([KID_HEX]);
  });

  it("ignores a value that is not a 16-byte key id", () => {
    expect(defaultKids(`<ContentProtection cenc:default_KID="deadbeef"/>`)).toEqual([]);
  });
});

describe("matchClearKeys", () => {
  it("uses the keys verbatim when an advertised id is one the manifest declares", () => {
    const res = matchClearKeys([{ kid: KID_HEX, k: KEY_HEX }], defaultKids(mpd([KID_UUID])));
    expect(res.status).toBe("exact");
    expect(res.keys).toEqual([{ kid: KID_HEX, k: KEY_HEX }]);
  });

  it("still matches when the catalogue spells the id as a UUID with dashes", () => {
    // `toHex16` strips dashes on the catalogue side; this asserts both sides converge.
    const res = matchClearKeys([{ kid: KID_UUID, k: KEY_HEX }], defaultKids(mpd([KID_UUID])));
    expect(res.status).toBe("exact");
  });

  it("relabels a single key onto the manifest's ids, and says that it did", () => {
    // The v.4.9 app's behaviour, kept deliberately: one key with a different id is more likely
    // a spelling difference than a wrong key. The status is what makes it auditable.
    const res = matchClearKeys([{ kid: OTHER_HEX, k: KEY_HEX }], defaultKids(mpd([KID_UUID])));
    expect(res.status).toBe("relabelled");
    expect(res.keys).toEqual([{ kid: KID_HEX, k: KEY_HEX }]);
  });

  it("refuses to guess when several keys disagree with the manifest", () => {
    // Relabelling here would mean picking one of two keys at random for a track we cannot
    // identify. Leave them alone and report `unmatched` so the black screen is explainable.
    const keys = [
      { kid: OTHER_HEX, k: KEY_HEX },
      { kid: "11111111111111111111111111111111", k: "22222222222222222222222222222222" },
    ];
    const res = matchClearKeys(keys, defaultKids(mpd([KID_UUID])));
    expect(res.status).toBe("unmatched");
    expect(res.keys).toEqual(keys);
  });

  it("reports the absence of keys rather than inventing a match", () => {
    const res = matchClearKeys([], defaultKids(mpd([KID_UUID])));
    expect(res.status).toBe("unmatched");
    expect(res.keys).toEqual([]);
  });
});
