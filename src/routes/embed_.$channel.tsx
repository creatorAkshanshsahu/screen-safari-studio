import { createFileRoute } from "@tanstack/react-router";
import { EmbedChannelPlayer } from "@/components/tv/EmbedChannelPlayer";

/**
 * `/embed/2524` — one channel, player only, for a host site's iframe.
 *
 * This is a route rather than a server-rendered string so that it runs **the same player as the
 * app**. It was a separate hand-written script before, and the two drifted: the app learned to play
 * the relay's resolved direct address and the embed did not, so `/live/tg:0-9-pictures` played while
 * `/embed/2524` sat on "connecting" for the same channel. A fix now lands in one place.
 *
 * `/embed` (the kit), `/embed/tgtv` (the whole section) and `/embed-sdk.js` are still served by the
 * gateway: they are documents about the player, not the player.
 */
export const Route = createFileRoute("/embed_/$channel")({
  head: () => ({
    meta: [
      { title: "STREAMR Live" },
      { name: "referrer", content: "no-referrer" },
      { name: "robots", content: "noindex" },
      { name: "description", content: "Live TV player by STREAMR." },
    ],
  }),
  component: EmbedChannelRoute,
});

function EmbedChannelRoute() {
  const { channel } = Route.useParams();
  return <EmbedChannelPlayer rawId={decodeURIComponent(channel)} />;
}
