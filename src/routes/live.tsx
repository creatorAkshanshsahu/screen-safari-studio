import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Code2, Copy, Check, Search } from "lucide-react";
import { LivePlayerStage, type StageChannel } from "@/components/tv/LivePlayerStage";
import { accentInk, parseAccent, type LiveChannelDto } from "@/lib/live-gateway";

export const Route = createFileRoute("/live")({
  head: () => ({
    meta: [
      { title: "Live TV — Streamr" },
      { name: "referrer", content: "no-referrer" },
      { name: "description", content: "Watch AK TV live channels with Hindi audio, channel numbers and embed codes." },
      { property: "og:title", content: "Live TV — Streamr" },
      { property: "og:description", content: "Watch AK TV live channels with Hindi audio, channel numbers and embed codes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LivePlayerContent,
});

/**
 * AK TV is the only source. maxTV and JioTV are gone from the product: they asked for a portal
 * account and a CDN that refuses datacentre addresses, and between them they accounted for every
 * failure this app has had. What is left is one playlist we do not have to fight.
 */
const SOURCE = "tgtv" as const;

export function LivePlayerContent({ initialChannelId }: { initialChannelId?: string } = {}) {
  const source = SOURCE;
  const [filter, setFilter] = useState<"hindi" | "en_hi" | "all">("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [query, setQuery] = useState("");
  const [channels, setChannels] = useState<LiveChannelDto[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  /**
   * What the URL asked for, before the catalogue has said which channel that is.
   *
   * A shared link is `/watch/2524` as often as it is `/watch/tg:0-9-pictures`, and the number is
   * enough to start: the relay resolves both to the same channel. Waiting for the list before
   * showing a picture is a second of black in front of a link someone just tapped.
   */
  const [requestedId, setRequestedId] = useState<string>(initialChannelId ?? "");
  const [loading, setLoading] = useState(true);
  const [containerKind, setContainerKind] = useState("MPEG-TS");
  const [showEmbedModal, setShowEmbedModal] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  /**
   * `?colour=FF6600` themes this player for whoever linked here, exactly as it themes an embed. Read
   * after mount rather than during render: this page is server-rendered too, and the query string
   * only exists in the browser.
   */
  const [accent, setAccent] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  /** The relay's own words about a playlist read that failed, rather than a guess about it. */
  const [tgtvError, setTgtvError] = useState<string | null>(null);
  /** The relay is still reading the playlist. Ask again shortly; it is not stuck. */
  const [warming, setWarming] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // A pasted link wins: /live/143, /live/tg:1001 and /live?ch=… are all the same request.
    const requested = initialChannelId || new URLSearchParams(window.location.search).get("ch");
    if (requested) {
      setRequestedId(requested);
      setActiveId(requested);
    }
  }, [initialChannelId]);

  /*
   * The guide keeps asking.
   *
   * Opening the site is the one moment the playlist is definitely not in this instance's memory,
   * and it used to be the moment the page asked exactly once -- then sat on "the playlist answered
   * but listed nothing", which was never what happened. The playlist was still being read, or its
   * host was slow, or the platform's proxy had cut the first request short. None of those are
   * fixed by asking a second time later; all of them are made visible by it.
   *
   * Backoff, a ceiling, and a stop the moment channels arrive: five attempts over about twenty
   * seconds, against a relay that answers its own read in eight.
   */
  const RETRY_DELAYS_MS = [1000, 2000, 3500, 5000, 7000];
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttempt = useRef(0);
  const loadRef = useRef<(force?: boolean) => Promise<void>>(async () => undefined);

  const cancelRetry = useCallback(() => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
  }, []);

  const scheduleRetry = useCallback(() => {
    if (retryTimer.current) return;
    const delay = RETRY_DELAYS_MS[Math.min(retryAttempt.current, RETRY_DELAYS_MS.length - 1)];
    if (retryAttempt.current >= RETRY_DELAYS_MS.length) return;
    retryAttempt.current += 1;
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      void loadRef.current(false);
    }, delay);
  }, []);

  useEffect(() => cancelRetry, [cancelRetry]);

  const loadCatalogue = useCallback(
    async (force = false) => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/live/channels?source=${encodeURIComponent(source)}&filter=${encodeURIComponent(filter)}${force ? "&refresh=1" : ""}`,
        );
        const data = (await res.json()) as {
          channels?: LiveChannelDto[];
          categories?: string[];
          portalError?: string | null;
          servedBy?: string;
          backupError?: string | null;
          tgtvError?: string | null;
          warming?: boolean;
        };
        const list = data.channels ?? [];
        setChannels(list);
        setCategories(data.categories ?? []);
        setPortalError(data.portalError ?? null);
        setBackupError(data.backupError ?? null);
        setTgtvError(data.tgtvError ?? null);
        setWarming(Boolean(data.warming));
        setSelectedCategory("");
        /*
         * Ask again while there is nothing to show. A manual refresh is the viewer taking the
         * wheel, so it resets the budget rather than counting against it.
         */
        if (list.length > 0) {
          retryAttempt.current = 0;
          cancelRetry();
        } else if (force) {
          retryAttempt.current = 0;
          scheduleRetry();
        } else {
          scheduleRetry();
        }
        if (list.length > 0) {
          /*
           * A pasted link may name a channel by number (`/live/2524`), by key
           * (`/live/tg:0-9-pictures`) or by slug. The list only carries the last two as ids, so a
           * number has to be matched against `number` -- otherwise a shared link silently opened
           * the first channel in the guide, which is the opposite of "it should land me on that
           * channel only".
           */
          const resolve = (wanted: string) =>
            list.find((c) => c.id === wanted) ??
            list.find((c) => String(c.number ?? "") === wanted) ??
            list.find((c) => c.key === wanted) ??
            null;
          setActiveId((prev) => resolve(prev)?.id ?? list[0]!.id);
        }
      } catch {
        // retain current list on transient error
      } finally {
        setLoading(false);
      }
    },
    [source, filter],
  );

  useEffect(() => {
    loadRef.current = loadCatalogue;
    // A different source or filter is a different question: its retry budget starts over.
    retryAttempt.current = 0;
    void loadCatalogue(false);
  }, [loadCatalogue]);

  /*
   * Coming back to the tab is the cheapest possible retry: the viewer is looking again, and the
   * catalogue they were waiting for may have landed while they were away.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onFocus = () => {
      if (channels.length === 0 && !retryTimer.current) {
        retryAttempt.current = 0;
        void loadRef.current(false);
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [channels.length]);

  const visibleChannels = useMemo(() => {
    const q = query.trim().toLowerCase();
    return channels.filter((c) => {
      if (selectedCategory && c.category !== selectedCategory) return false;
      if (!q) return true;
      return `${c.name} ${c.category}`.toLowerCase().includes(q);
    });
  }, [channels, selectedCategory, query]);

  const activeChannel = useMemo(
    () => channels.find((c) => c.id === activeId) ?? visibleChannels[0] ?? channels[0] ?? null,
    [channels, visibleChannels, activeId],
  );

  /**
   * Keep the address bar pointing at the channel on screen.
   *
   * `replaceState` rather than navigation: the player is already showing this channel, and a
   * route change would tear down the video element and start again. The point is only that
   * copying the URL hands someone the channel you are watching.
   */
  useEffect(() => {
    if (typeof window === "undefined" || !activeId) return;
    /*
     * Only under `/live`. This page is also served at `/watch/<id>` -- the reference site's name
     * for exactly this screen -- and rewriting that address to `/live/<id>` would quietly change
     * the URL someone shared.
     */
    if (!window.location.pathname.startsWith("/live")) return;
    const target = `/live/${encodeURIComponent(activeId)}`;
    if (window.location.pathname !== target) {
      window.history.replaceState(null, "", target + window.location.search);
    }
  }, [activeId]);

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("colour");
    const hex = parseAccent(raw);
    if (hex) setAccent(hex);
  }, []);

  /**
   * Picking a channel is an act of the viewer, so it replaces what the URL asked for.
   *
   * Without this, `requestedId` -- captured once from the address bar -- outlived every click: the
   * stage kept preferring the link's channel over the one just chosen, so the guide worked and the
   * picture never changed. No picture, and no way to pick another.
   */
  const pickChannel = (id: string) => {
    setRequestedId("");
    setActiveId(id);
  };

  const stepChannel = (delta: number) => {
    const pool = visibleChannels.length > 0 ? visibleChannels : channels;
    if (pool.length === 0 || !activeChannel) return;
    const idx = Math.max(0, pool.findIndex((c) => c.id === activeChannel.id));
    const next = pool[(idx + delta + pool.length) % pool.length];
    if (next) pickChannel(next.id);
  };

  const copySnippet = (key: string, text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1600);
    });
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const publicApiUrl = `${origin}/api/public/channels?q=`;
  const channelPublicUrl = activeChannel
    ? `${origin}/api/public/channels/${encodeURIComponent(String(activeChannel.number ?? activeChannel.id))}`
    : "";
  const channelWatchUrl = activeChannel
    ? `${origin}/watch/${encodeURIComponent(String(activeChannel.number ?? activeChannel.id))}`
    : "";
  const accentQuery = accent ? `?colour=${encodeURIComponent(accent)}` : "";
  const channelEmbedCode = activeChannel
    ? `<iframe src="${origin}/embed/${encodeURIComponent(String(activeChannel.number ?? activeChannel.id))}${accentQuery}" width="100%" height="480" frameborder="0" allowfullscreen allow="autoplay; fullscreen; encrypted-media; picture-in-picture"></iframe>`
    : "";
  const m3uUrl = `${origin}/api/live/playlist.m3u?source=${source}&filter=${filter}`;
  const sdkCode = `<div id="og-live-tv"></div>\n<script src="${origin}/embed-sdk.js" data-target="#og-live-tv" data-source="${source}" data-filter="${filter}"></script>`;

  /**
   * Does this catalogue entry answer to what the URL asked for? A link may name a channel by its
   * id, its number or its playlist key, and all three are the same channel.
   */
  const matchesRequest = (wanted: string, c: LiveChannelDto) =>
    c.id === wanted || String(c.number ?? "") === wanted || c.key === wanted;

  const describe = (c: LiveChannelDto): StageChannel => ({
    id: c.id,
    name: c.name,
    number: c.number,
    source: c.source,
    directUrl: c.directUrl,
    drm: c.drm ?? null,
    container: c.container,
  });

  /*
   * The player mounts on a channel the catalogue has actually named -- never on a guess.
   *
   * Mounting on the id from the address bar looked like a free head start and was not: on a cold
   * instance the engine's first probe ran before the catalogue existed, was answered with a 504
   * that carries no direct-play recipe, and the frame sat on "Connecting to …" with nothing to
   * fall back to. The list is one request away, it warms the catalogue the probe then reads, and
   * the player is no longer the thing that pays for the cold start.
   *
   * While the list is still loading, `activeChannel` falls back to the first entry, which may be a
   * different channel from the one in the address bar -- so it is only accepted once it matches.
   */
  const stageChannel: StageChannel | null =
    activeChannel && (!requestedId || matchesRequest(requestedId, activeChannel)) ? describe(activeChannel) : null;

  const activeNumber = activeChannel ? String(activeChannel.number ?? activeChannel.id) : "";

  return (
    /*
      The reference site's shape, on purpose.
      
      A viewer arrives from a shared link, wants to know what they are watching, and -- if it is not
      what they wanted -- wants the next channel one tap away. So: a titled header, a 16:9 player in
      normal flow, the channel's own line under it, then the guide. Nothing floats over the picture
      except the player's own controls, and nothing is hidden behind a drawer that only exists on a
      desktop.
    */
    <main
      className="min-h-screen w-full bg-black pb-16"
      style={
        accent
          ? ({
              "--accent": accent,
              "--accent-foreground": accentInk(accent),
            } as React.CSSProperties)
          : undefined
      }
    >
      <div className="mx-auto w-full max-w-5xl px-3 sm:px-6">
        <header className="flex items-center gap-2 py-3">
          <Link
            to="/"
            aria-label="All channels"
            className="glass inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold no-underline"
          >
            <ArrowLeft className="size-4" />
            <span className="hidden sm:inline">All channels</span>
          </Link>
          <p className="min-w-0 flex-1 truncate text-center font-display text-sm font-bold sm:text-base">
            {activeChannel?.name ?? (loading ? "Loading Live TV…" : "Live TV")}
          </p>
          <a
            href="/embed"
            className="glass inline-flex shrink-0 items-center rounded-full px-3 py-1.5 text-xs font-bold no-underline"
          >
            Docs
          </a>
        </header>

        <LivePlayerStage
          channel={stageChannel}
          variant="aspect"
          reloadNonce={reloadNonce}
          onReload={() => setReloadNonce((n) => n + 1)}
          watermark={{ href: "/", title: "STREAMR home" }}
          onContainerDetected={setContainerKind}
          onNextChannel={() => stepChannel(1)}
          onSwitchChannel={pickChannel}
          extras={
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => stepChannel(-1)}
                aria-label="Previous channel"
                className="glass inline-flex size-9 items-center justify-center rounded-full text-xs font-bold"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => stepChannel(1)}
                aria-label="Next channel"
                className="glass inline-flex size-9 items-center justify-center rounded-full text-xs font-bold"
              >
                ›
              </button>
            </div>
          }
        />

        {/* The channel's own line: what am I watching, where from, and how do I take it with me. */}
        <section className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
          <h1 className="font-display text-lg font-bold leading-tight break-words [overflow-wrap:anywhere] sm:text-xl">
            {activeChannel?.number !== undefined && (
              <span className="mr-2 tabular-nums text-accent">{activeChannel.number}</span>
            )}
            {activeChannel?.name ?? (loading ? "Loading…" : "No channel")}
          </h1>
          <span className="glass rounded-full px-2.5 py-1 text-[11px] font-bold text-accent">AK TV</span>
          {activeChannel && (
            <span className="text-xs text-muted-foreground">
              {activeChannel.category} · {containerKind}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {activeChannel && (
              <a
                href={`/watch/${encodeURIComponent(activeNumber)}`}
                className="glass rounded-full px-3 py-1.5 text-xs font-bold no-underline"
              >
                Watch page
              </a>
            )}
            <Button
              variant="secondary"
              onClick={() => setShowEmbedModal((v) => !v)}
              className="glass rounded-full px-3 py-1.5 text-xs font-bold"
            >
              <Code2 className="mr-1.5 size-4" /> Embed &amp; API
            </Button>
          </div>
        </section>

        {/* One source, so there is nothing to fall back from: say the list is short or dead. */}
        {(portalError || backupError || tgtvError || (!loading && visibleChannels.length === 0)) && (
          <div className="mb-3 rounded-xl border border-accent/40 bg-background/85 px-4 py-2.5 text-xs">
            {/*
             * "Still coming" and "came back empty" look identical on screen and are not the same
             * thing. The page knows which, because the relay says so -- and while it is the first,
             * the page is already asking again, so the honest label is a promise rather than an
             * error.
             */}
            <p className="font-bold text-accent">
              {channels.length === 0 && (warming || retryAttempt.current > 0)
                ? "AK TV returned no channels yet."
                : "AK TV returned no channels."}
            </p>
            <p className="mt-0.5 text-muted-foreground">
              {channels.length === 0 && (warming || retryAttempt.current > 0)
                ? `Retrying by itself — attempt ${Math.max(retryAttempt.current, 1)}. The relay is reading the playlist${
                    tgtvError ? ` (last answer: ${tgtvError})` : ""
                  }.`
                : (portalError ??
                  tgtvError ??
                  backupError ??
                  "The playlist answered but listed nothing. Press Refresh to try again.")}
            </p>
            <button
              type="button"
              onClick={() => {
                retryAttempt.current = 0;
                cancelRetry();
                void loadCatalogue(true);
              }}
              className="mt-2 rounded-full bg-accent px-3 py-1 text-[11px] font-bold text-accent-foreground"
            >
              Refresh now
            </button>
          </div>
        )}

        {/* Guide: a grid of channels, the numbers on them, and the filters above it. */}
        <section className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              {loading ? "Loading…" : `${visibleChannels.length} Channels`}
            </p>
            <button
              type="button"
              onClick={() => void loadCatalogue(true)}
              className="text-[11px] font-semibold text-accent hover:underline"
            >
              Refresh
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search channels…"
                aria-label="Search channels"
                className="w-full rounded-full border border-border bg-background/70 py-1.5 pl-9 pr-3 text-xs outline-none focus:border-accent"
              />
            </div>
            <div className="glass flex rounded-full p-1 text-xs font-semibold">
              {(
                [
                  ["hindi", "Hindi"],
                  ["en_hi", "India + Eng"],
                  ["all", "All"],
                ] as const
              ).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setFilter(val)}
                  className={`rounded-full px-3 py-1 transition ${filter === val ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-0.5">
            <button
              type="button"
              onClick={() => setSelectedCategory("")}
              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${selectedCategory === "" ? "bg-primary text-primary-foreground" : "glass text-muted-foreground"}`}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${selectedCategory === cat ? "bg-primary text-primary-foreground" : "glass text-muted-foreground"}`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {visibleChannels.slice(0, 250).map((ch) => {
              const selected = activeChannel?.id === ch.id;
              return (
                <button
                  type="button"
                  key={ch.id}
                  onClick={() => pickChannel(ch.id)}
                  aria-pressed={selected}
                  className={`flex items-center gap-2.5 rounded-xl p-2.5 text-left transition ${
                    selected ? "bg-primary text-primary-foreground" : "glass hover:border-accent/60"
                  }`}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-background/40 font-display text-xs font-bold tabular-nums">
                    {ch.number ?? ch.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-bold sm:text-sm">{ch.name}</span>
                    <span className={`block truncate text-[10px] ${selected ? "opacity-80" : "text-muted-foreground"}`}>
                      {ch.category}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {!loading && visibleChannels.length === 0 && (
            <p className="py-1 text-xs text-muted-foreground">
              {query.trim() ? `No channels match “${query.trim()}”.` : "No channels match this filter. Try “All”."}
            </p>
          )}
        </section>
      </div>

      {/* The snippets, on demand: nobody needs a code block under the player while watching. */}
      {showEmbedModal && activeChannel && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 p-4 sm:p-8">
          <div className="w-full max-w-xl space-y-3 rounded-2xl border border-border bg-background p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-base font-bold">Embed {activeChannel.name}</h2>
              <a href="/embed" target="_blank" rel="noopener" className="text-[11px] font-semibold text-accent underline">
                Full guide, colour and API
              </a>
              <Button variant="secondary" size="sm" onClick={() => setShowEmbedModal(false)} className="rounded-full text-xs">
                Close
              </Button>
            </div>

            {[
              { key: "iframe", label: "1. This channel · iframe", value: channelEmbedCode },
              { key: "one", label: "2. This channel · sources and ClearKey (JSON)", value: channelPublicUrl },
              { key: "api", label: "3. Channel list (public JSON API)", value: publicApiUrl },
              { key: "watch", label: "4. This channel · full page", value: channelWatchUrl },
              { key: "m3u", label: "5. AK TV M3U playlist", value: m3uUrl },
              { key: "sdk", label: "6. Player and channel grid (script tag)", value: sdkCode },
            ].map((item) => (
              <div key={item.key} className="space-y-1 rounded-xl border border-border bg-background/80 p-3">
                <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
                  <span>{item.label}</span>
                  <button
                    type="button"
                    onClick={() => copySnippet(item.key, item.value)}
                    className="inline-flex items-center gap-1 text-accent hover:underline"
                  >
                    {copiedKey === item.key ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {copiedKey === item.key ? "Copied" : "Copy"}
                  </button>
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] text-foreground">
                  {item.value}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
