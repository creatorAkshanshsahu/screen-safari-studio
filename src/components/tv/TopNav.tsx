import { Link } from "@tanstack/react-router";
import { Search, User } from "lucide-react";
import logoMark from "@/assets/logo-mark.png";
import { Button } from "@/components/ui/button";

const tabs = [
  { to: "/", label: "Home" },
  { to: "/movies", label: "Movies" },
  { to: "/series", label: "Series" },
  { to: "/live", label: "Live TV" },
] as const;

export function TopNav() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 flex flex-wrap items-center gap-4 px-4 py-4 md:flex-nowrap md:px-12 md:py-6">
      <Link to="/" className="flex shrink-0 items-center gap-2.5">
        <img src={logoMark} alt="STREAMR logo" width={1024} height={1024} loading="lazy" className="size-8 shrink-0 md:size-10" />
        <span className="text-brand font-display text-xl font-bold md:text-2xl">STREAMR</span>
      </Link>
      <nav className="glass no-scrollbar mx-auto flex w-full gap-1 overflow-x-auto rounded-full p-1 md:w-auto">
        {tabs.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            activeOptions={{ exact: true }}
            className="whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-semibold text-muted-foreground transition hover:text-foreground md:px-5 md:py-2 md:text-base"
            activeProps={{ className: "bg-primary !text-primary-foreground" }}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="hidden items-center gap-3 md:flex">
        <Button variant="secondary" size="icon" title="Search" aria-label="Search" className="glass rounded-full"><Search className="size-5" /></Button>
        <Button size="icon" title="Profile" aria-label="Profile" className="rounded-full bg-accent text-accent-foreground"><User className="size-5" /></Button>
      </div>
    </header>
  );
}
