import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PlayerHeader({ title, subtitle, live }: { title: string; subtitle: string; live?: boolean }) {
  const [clock, setClock] = useState("");
  useEffect(() => {
    const update = () => setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    update();
    const timer = window.setInterval(update, 30000);
    return () => window.clearInterval(timer);
  }, []);
  return <header className="player-header">
    <div className="flex min-w-0 items-center gap-4">
      <Button asChild variant="player" size="playerIcon"><Link to="/" aria-label="Back to home"><ArrowLeft /></Link></Button>
      <div className="min-w-0"><div className="flex items-center gap-2"><span className="font-display text-sm font-bold text-brand">STREAMR</span><span className="player-kicker">/ {live ? "LIVE TV" : "CINEMA"}</span></div><p className="truncate text-base font-semibold md:text-xl">{title}</p><p className="truncate text-xs text-player-muted">{subtitle}</p></div>
    </div>
    <div className="shrink-0 text-right"><time className="font-display text-sm md:text-xl">{clock}</time><p className="player-kicker mt-1">{live ? "ON AIR" : "4K · HDR"}</p></div>
  </header>;
}

export function PlayerAction({ icon: Icon, label, onClick, active, primary }: { icon: LucideIcon; label: string; onClick: () => void; active?: boolean; primary?: boolean }) {
  return <Button variant={primary ? "playerPrimary" : "player"} size="player" onClick={onClick} aria-pressed={active} className={active ? "border-accent text-accent" : ""}><Icon /><span>{label}</span></Button>;
}

export function PlayerPanel({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  useEffect(() => {
    const old = document.activeElement;
    const panel = document.querySelector<HTMLElement>(".player-panel");
    panel?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); if (old instanceof HTMLElement) old.focus(); };
  }, [close]);
  return <aside className="player-panel" aria-label={title}>
    <div className="mb-6 flex items-center justify-between gap-4"><h2 className="text-lg">{title}</h2><Button variant="player" size="playerIcon" onClick={close} aria-label={`Close ${title}`}><X /></Button></div>
    {children}
  </aside>;
}

export function PlayerBadge({ children }: { children: ReactNode }) { return <span className="player-badge">{children}</span>; }

export function togglePlayerFullscreen() {
  if (document.fullscreenElement) { void document.exitFullscreen().catch(() => undefined); }
  else { void document.querySelector(".player-scene")?.requestFullscreen?.().catch(() => undefined); }
}