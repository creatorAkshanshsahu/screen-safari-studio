import { Link } from "@tanstack/react-router";
import { Search, User } from "lucide-react";

const tabs = [
  { to: "/", label: "Home" },
  { to: "/movies", label: "Movies" },
  { to: "/series", label: "Series" },
  { to: "/live", label: "Live TV" },
] as const;

export function TopNav() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 flex items-center gap-4 px-4 py-4 md:px-12 md:py-6">
      <span className="font-display text-xl font-bold tracking-tight text-accent md:text-2xl">STREAMR</span>
      <nav className="glass no-scrollbar mx-auto flex gap-1 overflow-x-auto rounded-full p-1">
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
        <button aria-label="Search" className="glass rounded-full p-2.5"><Search className="size-5" /></button>
        <button aria-label="Profile" className="rounded-full bg-accent p-2.5 text-accent-foreground"><User className="size-5" /></button>
      </div>
    </header>
  );
}
