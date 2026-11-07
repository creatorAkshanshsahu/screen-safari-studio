import { createFileRoute } from "@tanstack/react-router";
import { TopNav } from "@/components/tv/TopNav";
import { Hero, Rail } from "@/components/tv/Rails";
import { titles } from "@/lib/catalog";
import { ChannelRail } from "@/components/tv/ChannelRail";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Streamr — TV Home" },
      { name: "description", content: "Streaming TV app home with movies, series and live channels." },
      { property: "og:title", content: "Streamr — TV Home" },
      { property: "og:description", content: "Streaming TV app home with movies, series and live channels." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

function Home() {
  return (
    <main className="min-h-screen pb-16">
      <TopNav />
      <Hero />
      <div className="-mt-10 relative space-y-6">
        <ChannelRail />
        <Rail label="Continue Watching" items={titles.filter((t) => t.progress)} wide />
        <Rail label="Trending Now" items={titles} />
        <Rail label="New Series" items={titles.filter((t) => t.kind === "series")} />
        <Rail label="Top Movies" items={titles.filter((t) => t.kind === "movie")} wide />
      </div>
    </main>
  );
}
