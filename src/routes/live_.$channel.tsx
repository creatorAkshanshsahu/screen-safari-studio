import { createFileRoute } from "@tanstack/react-router";
import { LivePlayerContent } from "@/routes/live";

/**
 * One channel, one URL: `/live/143`, `/live/tg:set-hd`, `/live/sony-set-hd`.
 *
 * This is the address a viewer shares. The channel is resolved by number, playlist id or name
 * by the same server-side resolver the embeds use, so the link keeps working when the playlist
 * is re-sourced. The player itself is the live page's, unchanged -- only the starting channel
 * differs, and the page keeps the address bar in step as the viewer zaps.
 */
export const Route = createFileRoute("/live_/$channel")({
  head: ({ params }) => ({
    meta: [
      { title: `Live TV — ${decodeURIComponent(params.channel)} · Streamr` },
      { name: "referrer", content: "no-referrer" },
      { name: "description", content: "Watch AK TV live channels with Hindi audio." },
      { property: "og:title", content: "Live TV — Streamr" },
      { property: "og:description", content: "Watch AK TV live channels with Hindi audio." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LiveChannelRoute,
});

function LiveChannelRoute() {
  const { channel } = Route.useParams();
  return <LivePlayerContent initialChannelId={decodeURIComponent(channel)} />;
}
