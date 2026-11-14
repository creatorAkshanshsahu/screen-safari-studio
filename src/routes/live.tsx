import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  ChevronUp,
  ChevronDown,
  Volume2,
  VolumeX,
  RefreshCw,
  Code2,
  Search,
  Copy,
  Check,
  Languages,
  Maximize,
} from "lucide-react";
import { LiveVideoSurface, type AudioTrackOption } from "@/components/tv/LiveVideoSurface";
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
  const [loading, setLoading] = useState(true);
  const [muted, setMuted] = useState(false);
  const [autoMutedBanner, setAutoMutedBanner] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [containerKind, setContainerKind] = useState("MPEG-TS");
  const [audioTracks, setAudioTracks] = useState<AudioTrackOption[]>([]);
  const [activeAudio, setActiveAudio] = useState(-1);
  const [showEmbedModal, setShowEmbedModal] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [portalError, setPortalError] = useState<string | null>(null);
  /**
   * `?colour=FF6600` themes this player for whoever linked here, exactly as it themes an embed. Read
   * after mount rather than during render: this page is server-rendered too, and the query string
   * only exists in the browser.
   */
  const [accent, setAccent] = useState<string | null>(null);
  const [servedBy, setServedBy] = useState<string>("");
  const [backupError, setBackupError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // A pasted link wins: /live/143, /live/tg:1001 and /live?ch=… are all the same request.
    const requested = initialChannelId || new URLSearchParams(window.location.search).get("ch");
    if (requested) setActiveId(requested);
  }, [initialChannelId]);

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
        };
        const list = data.channels ?? [];
        setChannels(list);
        setCategories(data.categories ?? []);
        setPortalError(data.portalError ?? null);
        setServedBy(data.servedBy ?? "");
        setBackupError(data.backupError ?? null);
        setSelectedCategory("");
        if (list.length > 0) {
          setActiveId((prev) => (prev && list.some((c) => c.id === prev) ? prev : list[0]!.id));
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
    void loadCatalogue(false);
  }, [loadCatalogue]);

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
    const target = `/live/${encodeURIComponent(activeId)}`;
    if (window.location.pathname !== target) {
      window.history.replaceState(null, "", target + window.location.search);
    }
  }, [activeId]);

  const stepChannel = (delta: number) => {
    const pool = visibleChannels.length > 0 ? visibleChannels : channels;
    if (pool.length === 0 || !activeChannel) return;
    const idx = Math.max(0, pool.findIndex((c) => c.id === activeChannel.id));
    const next = pool[(idx + delta + pool.length) % pool.length];
    if (next) setActiveId(next.id);
  };

  const handleTracks = useCallback((tracks: AudioTrackOption[], idx: number) => {
    setAudioTracks(tracks);
    setActiveAudio(idx);
  }, []);

  const copySnippet = (key: string, text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1600);
    });
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const apiUrl = `${origin}/api/live/channels?source=${source}&filter=${filter}`;
  // The documented surface, and the one to hand a host site: it is not this app's plumbing.
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

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("colour");
    const hex = parseAccent(raw);
    if (hex) setAccent(hex);
  }, []);

  const handleAutoMuted = useCallback(() => {
    setMuted(true);
    setAutoMutedBanner(true);
  }, []);

  return (
    /*
      Two layouts, one DOM.

      Desktop keeps the full-bleed scene: the picture is the page, the bars float over it.

      A phone gets a 16:9 player that occupies its own box at the top, everything else in normal
      flow underneath. The old single layout stretched the player to the whole viewport on a
      phone, so the channel chooser sat a full screen below a black void -- which is why a refused
      channel felt like a trap, and why every overlay we added landed on something. A player that
      owns exactly its own rectangle cannot cover the controls, and the channel you want is one
      short scroll away.
    */
    <main
      className="player-scene relative flex min-h-screen w-full flex-col bg-black lg:block lg:h-screen lg:overflow-hidden"
      style={
        accent
          ? ({
              "--accent": accent,
              "--accent-foreground": accentInk(accent),
              // The brand's own red lives in `--crimson-bright`; the LIVE chip and the focus rings
              // read `--accent`, so setting it here is enough to re-theme the whole page.
            } as React.CSSProperties)
          : undefined
      }
    >
      <div className="relative aspect-video w-full shrink-0 bg-black lg:absolute lg:inset-0 lg:aspect-auto">
        {activeChannel && (
          <LiveVideoSurface
            channelId={activeChannel.id}
            channelName={activeChannel.name}
            directUrl={activeChannel.directUrl}
            drm={activeChannel.drm ?? null}
            container={activeChannel.container}
            activeSource={activeChannel.source}
            muted={muted}
            reloadNonce={reloadNonce}
            selectedAudioTrack={activeAudio}
            onAudioTracksChange={handleTracks}
            onContainerDetected={setContainerKind}
            onAutoMuted={handleAutoMuted}
            onNextChannel={() => stepChannel(1)}
            onSwitchChannel={(id) => setActiveId(id)}
          />
        )}
      </div>

      <div className="bg-player-scrim pointer-events-none absolute inset-0 hidden lg:block" />

      {/* Top Bar: below the player in flow on a phone, over it on desktop. */}
      <div className="z-20 flex flex-wrap items-center justify-between gap-3 p-4 lg:absolute lg:inset-x-0 lg:top-0 md:p-8">
        <div className="flex items-center gap-3">
          <Link to="/" aria-label="Back" className="glass rounded-full p-2.5">
            <ArrowLeft className="size-5" />
          </Link>
          <span className="rounded bg-live px-2.5 py-0.5 text-xs font-bold tracking-widest text-white">LIVE</span>
          {/* Branding, in the header row rather than floating over the picture.
              On a phone the player and the channel guide occupy the same box, so a corner overlay
              lands on the controls or the channel you are trying to pick — which is exactly what
              was reported. In the embed the badge stays over the video, because there the video
              really is the whole frame and nothing sits under it. */}
          <Link
            to="/"
            title="STREAMR home"
            aria-label="STREAMR"
            className="glass inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-extrabold tracking-[0.14em] text-foreground no-underline"
          >
            <img src="/favicon.png" alt="" width={14} height={14} className="size-3.5 rounded-[3px]" />
            STREAMR
          </Link>
          <div className="min-w-0 flex-1 basis-full sm:basis-auto">
            <p className="font-display text-base font-bold leading-tight break-words [overflow-wrap:anywhere] line-clamp-2 md:text-2xl">
              {activeChannel?.number !== undefined && (
                <span className="mr-2 tabular-nums text-accent">{activeChannel.number}</span>
              )}
              {activeChannel?.name ?? "Loading Live TV…"}
            </p>
            <p className="text-xs text-muted-foreground">
              {activeChannel
                ? `${activeChannel.source.toUpperCase()} · ${activeChannel.category} · ${containerKind}`
                : loading
                  ? "Loading channels…"
                  : "No channels available from this source"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="glass rounded-full px-3 py-1 text-xs font-bold text-accent">AK TV</div>

          <div className="glass flex rounded-full p-1 text-xs font-semibold">
            {(
              [
                ["hindi", "Indian Hindi"],
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

          <Button
            variant="secondary"
            onClick={() => setShowEmbedModal((v) => !v)}
            className="glass rounded-full px-4 text-xs font-bold"
          >
            <Code2 className="mr-1.5 size-4" /> OG Embed &amp; API
          </Button>
        </div>
      </div>

      {/* One source, so there is nothing to fall back from: say the list is short or dead, or
          say nothing at all. */}
      {(portalError || backupError || (!loading && visibleChannels.length === 0)) && (
        <div className="relative z-30 mx-4 rounded-xl border border-accent/40 bg-background/85 px-4 py-2.5 text-xs lg:absolute lg:left-8 lg:right-auto lg:top-20 lg:mx-0 lg:max-w-xl">
          <p className="font-bold text-accent">AK TV returned no channels.</p>
          <p className="mt-0.5 text-muted-foreground">
            {portalError ?? backupError ?? "The playlist answered but listed nothing. Press Refresh to try again."}
          </p>
        </div>
      )}

      {/* Desktop Channel Guide Drawer */}
      <aside className="glass absolute bottom-32 right-4 top-24 z-20 hidden w-88 flex-col gap-2.5 overflow-hidden rounded-2xl p-3 lg:right-8 lg:flex">
        <div className="flex items-center justify-between px-1">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            {loading ? "Loading…" : `${visibleChannels.length} Channels`}
          </p>
          <button
            type="button"
            onClick={() => void loadCatalogue(true)}
            className="text-xs font-semibold text-accent hover:underline"
          >
            Refresh
          </button>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Star Sports, Sony, News…"
            className="w-full rounded-full border border-border bg-background/70 py-1.5 pl-9 pr-3 text-xs outline-none focus:border-accent"
          />
        </div>

        <div className="no-scrollbar flex shrink-0 gap-1.5 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setSelectedCategory("")}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${selectedCategory === "" ? "bg-primary text-primary-foreground" : "bg-secondary/60 text-muted-foreground"}`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${selectedCategory === cat ? "bg-primary text-primary-foreground" : "bg-secondary/60 text-muted-foreground"}`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="flex-1 space-y-1.5 overflow-y-auto pr-1">
          {visibleChannels.slice(0, 250).map((ch) => {
            const selected = activeChannel?.id === ch.id;
            return (
              <Button
                variant="secondary"
                key={ch.id}
                onClick={() => setActiveId(ch.id)}
                className={`flex h-auto w-full items-center justify-start gap-3 rounded-xl p-2.5 text-left transition ${selected ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-background/40 font-display text-xs font-bold tabular-nums">
                  {ch.number ?? ch.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">{ch.name}</span>
                  <span className={`block truncate text-[11px] ${selected ? "opacity-80" : "text-muted-foreground"}`}>
                    {ch.category}
                  </span>
                </span>
              </Button>
            );
          })}
        </div>
      </aside>

      {/* OG Website Embed & API Modal */}
      {showEmbedModal && activeChannel && (
        <div className="glass absolute left-4 right-4 top-24 z-30 max-w-xl space-y-3 rounded-2xl p-5 md:left-8">
          <div className="flex items-center justify-between">
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
      )}

      {/* Bottom Controls */}
      <div className="z-20 space-y-3 p-4 lg:absolute lg:inset-x-0 lg:bottom-0 md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* The browsers refuse unmuted autoplay, so we start muted and tell the viewer how to
                fix it — on this button, which is the control that actually does it. This used to be
                a bubble floating at `top-24`, which on a phone landed squarely on the channel name
                and the filter pills: it covered the things you had to touch to use the page. A
                hint must never sit on top of the UI it is describing. */}
            <Button
              variant="secondary"
              onClick={() => {
                setAutoMutedBanner(false);
                setMuted((m) => !m);
              }}
              className={`glass rounded-full px-4 text-xs font-bold ${muted && autoMutedBanner ? "animate-pulse border border-accent text-accent ring-2 ring-accent/40" : ""}`}
            >
              {muted ? <VolumeX className="mr-1.5 size-4" /> : <Volume2 className="mr-1.5 size-4" />}
              {muted ? (autoMutedBanner ? "Tap to Unmute" : "Unmute") : "Mute"}
            </Button>

            <Button
              variant="secondary"
              onClick={() => setReloadNonce((n) => n + 1)}
              className="glass rounded-full px-4 text-xs font-bold"
            >
              <RefreshCw className="mr-1.5 size-4" /> Reload Link
            </Button>

            {audioTracks.length > 1 && (
              <label className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold">
                <Languages className="size-4 text-accent" />
                <select
                  value={activeAudio}
                  onChange={(e) => setActiveAudio(Number(e.target.value))}
                  className="bg-transparent text-xs outline-none"
                >
                  {audioTracks.map((t) => (
                    <option key={t.index} value={t.index} className="bg-background text-foreground">
                      Audio: {t.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <Button
              variant="secondary"
              onClick={() => {
                if (document.fullscreenElement) void document.exitFullscreen();
                else void document.querySelector(".player-scene")?.requestFullscreen?.();
              }}
              className="glass rounded-full p-2.5"
              aria-label="Fullscreen"
            >
              <Maximize className="size-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => stepChannel(-1)} aria-label="Previous channel" className="glass rounded-full p-2.5">
              <ChevronUp className="size-5" />
            </Button>
            <Button variant="secondary" onClick={() => stepChannel(1)} aria-label="Next channel" className="glass rounded-full p-2.5">
              <ChevronDown className="size-5" />
            </Button>
          </div>
        </div>

        {/* Compact channel guide: every viewport below lg gets a horizontal rail so the
            channel list is never hidden behind a desktop-only drawer. */}
        <div className="space-y-2 lg:hidden">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              {loading ? "Loading…" : `${visibleChannels.length} Channels`}
            </p>
            <button type="button" onClick={() => void loadCatalogue(true)} className="text-[11px] font-semibold text-accent hover:underline">
              Refresh
            </button>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2 size-3.5 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search channels…"
              aria-label="Search channels"
              className="w-full rounded-full border border-border bg-background/70 py-1 pl-8 pr-3 text-[11px] outline-none focus:border-accent"
            />
          </div>

          <div className="no-scrollbar flex shrink-0 gap-1.5 overflow-x-auto pb-0.5">
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

          <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
            {visibleChannels.length === 0 && (
              <p className="px-1 py-1.5 text-[11px] text-muted-foreground">
                {loading ? "Loading channels…" : query.trim() ? `No channels match “${query.trim()}”.` : "No channels from this source."}
              </p>
            )}
            {visibleChannels.map((ch) => (
              <Button
                variant="secondary"
                key={ch.id}
                onClick={() => setActiveId(ch.id)}
                className={`h-auto shrink-0 rounded-xl px-3 py-1.5 text-left text-xs font-bold ${activeChannel?.id === ch.id ? "bg-primary text-primary-foreground" : "glass"}`}
              >
                {ch.number !== undefined && <span className="mr-1.5 tabular-nums opacity-60">{ch.number}</span>}
                {ch.name}
              </Button>
            ))}
          </div>

          {!loading && visibleChannels.length === 0 && (
            <p className="text-xs text-muted-foreground">No channels match this filter. Try “All”.</p>
          )}
        </div>
      </div>
    </main>
  );
}
