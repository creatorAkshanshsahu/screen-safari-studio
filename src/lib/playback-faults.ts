/**
 * Naming a playback failure by its cause instead of its symptom.
 *
 * Both players hand us a precise reason and both were throwing it away:
 *
 *   - hls.js emits `data.details` ("manifestLoadError", "fragLoadError", "keyLoadError",
 *     "bufferAppendError", …) plus `data.response.code`. The HLS fatal handler read only
 *     `data.fatal` and then chose a sentence by *source name*, so every HLS failure on every
 *     channel read "Live HLS stream interrupted".
 *   - Shaka emits a numeric error code whose first digit is the category (1 = network,
 *     3 = media/decode, 6 = DRM/EME). The direct-DASH path recorded the code and then
 *     reported a stall by whether frames appeared, so a key or codec failure became "taking
 *     too long to deliver video frames. Press Retry to switch token/server" — advice that
 *     cannot work, because a wrong key does not get better with a new token.
 *
 * A viewer pressing Retry for the third time on advice that was never true is the actual cost
 * of guessing. These functions are pure so the mapping can be pinned by tests without a
 * browser, a player, or a network.
 */

export type PlaybackSource = "maxtv" | "jio" | "tgtv";

export type FaultKind = "network" | "manifest" | "key" | "codec" | "unknown";

export type PlaybackFault = {
  kind: FaultKind;
  /** The player's own words, kept for the diagnose view and for support. */
  detail?: string | undefined;
  status?: number | undefined;
  message: string;
};

/** `activeSource` is a plain string in the player; anything unrecognised is a maxTV stream. */
function normalizeSource(source: string | undefined): PlaybackSource {
  return source === "jio" || source === "tgtv" ? source : "maxtv";
}

/** The remedy that actually applies to this source, appended when a status is known. */
function retryAdvice(source: PlaybackSource): string {
  if (source === "jio") return "Press Retry for a fresh CDN token.";
  if (source === "tgtv") return "Press Retry to reconnect.";
  return "Press Retry for a fresh portal link.";
}

/** The old per-source sentence, still the right answer when the player tells us nothing. */
function unknownMessage(source: PlaybackSource): string {
  if (source === "jio") {
    return "This JioTV stream was interrupted. Press Retry to reload it with a fresh CDN token.";
  }
  if (source === "tgtv") return "This AK TV stream was interrupted. Press Retry to reconnect.";
  return "Live HLS stream interrupted. Press Retry to request a fresh stream token.";
}

/**
 * Turn an hls.js ERROR payload into a sentence that names the fault.
 *
 * `data.response.code` is present only when a request actually came back with a status, which
 * is what separates "the host refused us" from "the host sent us something unusable".
 */
export function describeHlsFatal(data: unknown, sourceName?: string): PlaybackFault {
  const source = normalizeSource(sourceName);
  const d = (data ?? {}) as {
    details?: unknown;
    reason?: unknown;
    response?: { code?: unknown };
  };
  const detail = typeof d.details === "string" ? d.details : undefined;
  const rawStatus = d.response?.code;
  const status = typeof rawStatus === "number" && rawStatus >= 100 ? rawStatus : undefined;
  const kind = classifyHls(detail);

  if (kind === "manifest") {
    if (status) {
      return {
        kind,
        ...(detail ? { detail } : {}),
        status,
        message: `The stream's playlist was refused (HTTP ${status}). ${retryAdvice(source)}`,
      };
    }
    return {
      kind,
      ...(detail ? { detail } : {}),
      message:
        "The stream host answered with something that is not an HLS playlist. The link has most likely expired, or this is a raw MPEG-TS stream wearing an .m3u8 name.",
    };
  }

  if (kind === "key") {
    return {
      kind,
      ...(detail ? { detail } : {}),
      ...(status ? { status } : {}),
      message:
        "This playlist's AES key could not be fetched, so nothing can be decrypted. A key failure, not the network.",
    };
  }

  if (kind === "codec") {
    return {
      kind,
      ...(detail ? { detail } : {}),
      message:
        "The browser could not build a decoder for this stream's audio or video. A codec fault, not the network — another source is the way to watch this channel.",
    };
  }

  if (kind === "network") {
    if (status) {
      return {
        kind,
        ...(detail ? { detail } : {}),
        status,
        message: `The stream's media was refused (HTTP ${status}) after a playlist that loaded. ${retryAdvice(source)}`,
      };
    }
    return {
      kind,
      ...(detail ? { detail } : {}),
      message: `The stream's media stopped arriving. ${retryAdvice(source)}`,
    };
  }

  return { kind: "unknown", ...(detail ? { detail } : {}), message: unknownMessage(source) };
}

function classifyHls(detail: string | undefined): FaultKind {
  if (!detail) return "unknown";
  // Manifest: the playlist itself never became usable.
  if (
    detail.startsWith("manifestLoad") ||
    detail.startsWith("levelLoad") ||
    detail === "levelEmptyError" ||
    detail === "manifestParsingError" ||
    detail === "manifestIncompatibleCodecsError" ||
    detail === "levelParsingError"
  ) {
    // A playlist that parsed but carried no acceptable level is a codec problem, not a load one.
    if (detail === "manifestIncompatibleCodecsError" || detail === "levelParsingError") {
      return "codec";
    }
    return "manifest";
  }
  // The AES decryption key for the segment stream.
  if (detail.startsWith("keyLoad")) return "key";
  // Segments: refused (with a status) or simply stopped.
  if (
    detail.startsWith("fragLoad") ||
    detail.startsWith("fragParsing") ||
    detail === "fragGap" ||
    detail === "bufferSeekOverHole"
  ) {
    return detail === "fragParsingError" ? "codec" : "network";
  }
  // Decode / demux: the bytes arrived and the browser could not use them.
  if (detail.startsWith("bufferAppend") || detail.startsWith("bufferAddCodec") || detail.startsWith("bufferIncompatibleCodecs")) {
    return "codec";
  }
  if (detail === "bufferStalledError" || detail === "bufferNudgeOnStall") return "network";
  if (detail === "mediaError" || detail === "abrIncompatibleCodecs") return "codec";
  return "unknown";
}

/**
 * Attribute a direct-DASH stall.
 *
 * Shaka's code categories: 1000s network, 3000s media (decode, MSE, demux), 6000s DRM and EME.
 * A stall whose only evidence is a 3xxx/6xxx code is never fixed by a new token, so it must not
 * be reported as one.
 */
export function describeShakaStall(input: {
  code?: number | undefined;
  container?: "dash" | "hls" | undefined;
  hadKeys?: boolean | undefined;
  source?: string | undefined;
}): PlaybackFault {
  const { code, hadKeys } = input;
  const source = normalizeSource(input.source ?? "jio");

  if (typeof code === "number" && code >= 6000) {
    return {
      kind: "key",
      detail: `Shaka ${code}`,
      message: `The channel's key was refused by the browser (Shaka ${code}), so nothing can be decrypted. A key fault, not the connection — a new token cannot fix it.`,
    };
  }

  if (typeof code === "number" && code >= 3000 && code < 6000) {
    return {
      kind: "codec",
      detail: `Shaka ${code}`,
      message:
        hadKeys === false
          ? `Nothing decrypted (Shaka ${code}). This channel's playlist advertises no ClearKey, and an encrypted channel with no key decodes to black — the playlist is the problem here, not your connection.`
          : `Nothing decrypted (Shaka ${code}). The key or the codec is wrong for this channel, not the connection.`,
    };
  }

  if (typeof code === "number" && code >= 1000 && code < 2000) {
    return {
      kind: "network",
      detail: `Shaka ${code}`,
      message: `The CDN stopped answering (Shaka ${code}). ${retryAdvice(source)}`,
    };
  }

  // No code at all: the player never got far enough to raise one.
  if (hadKeys === false) {
    return {
      kind: "key",
      detail: "no keys advertised",
      message:
        "This channel's playlist advertises no ClearKey. If it is encrypted — kids channels usually are — there is no key to decrypt it with, and no amount of retrying will produce a picture.",
    };
  }

  return {
    kind: "unknown",
    message: `Direct CDN stream is taking too long to deliver video frames. ${retryAdvice(source)}`,
  };
}
