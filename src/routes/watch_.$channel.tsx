import { createFileRoute } from "@tanstack/react-router";
import { LivePlayerContent } from "@/routes/live";

/**
 * `/watch/143` — the same channel as `/live/143`, under the name the reference site publishes.
 *
 * Both exist on purpose. `/live/<n>` is what this app has always handed out and what every earlier
 * link, QR code and shared message contains, so it cannot be retired. `/watch/<n>` is the address a
 * host site's documentation will use, and any code copied from the reference site will ask for it.
 * One player, two doors.
 */
export const Route = createFileRoute("/watch_/$channel")({
  head: ({ params }) => ({
    meta: [
      { title: `Watch live — ${decodeURIComponent(params.channel)} · Streamr` },
      { name: "referrer", content: "no-referrer" },
      { name: "description", content: "Watch this AK TV channel live." },
      { property: "og:title", content: "Watch live — Streamr" },
      { property: "og:description", content: "Watch this AK TV channel live." },
      { property: "og:type", content: "video.other" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WatchChannelRoute,
});

function WatchChannelRoute() {
  const { channel } = Route.useParams();
  return <LivePlayerContent initialChannelId={decodeURIComponent(channel)} />;
}
