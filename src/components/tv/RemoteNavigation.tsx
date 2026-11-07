import { useEffect } from "react";

/** Directional focus for TV remotes; ordinary laptop tab navigation stays intact. */
export function RemoteNavigation() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const controls = Array.from(document.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]'))
        .filter((element) => element.getClientRects().length > 0);
      const current = document.activeElement;
      if (!(current instanceof HTMLElement) || !controls.includes(current)) {
        controls[0]?.focus();
        event.preventDefault();
        return;
      }
      const origin = current.getBoundingClientRect();
      const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
      const sign = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
      const candidates = controls.filter((element) => element !== current).map((element) => {
        const rect = element.getBoundingClientRect();
        const dx = rect.x + rect.width / 2 - origin.x - origin.width / 2;
        const dy = rect.y + rect.height / 2 - origin.y - origin.height / 2;
        const forward = (horizontal ? dx : dy) * sign;
        const cross = Math.abs(horizontal ? dy : dx);
        return { element, forward, score: forward + cross * 3 };
      }).filter(({ forward }) => forward > 8).sort((a, b) => a.score - b.score);
      candidates[0]?.element.focus();
      event.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return null;
}