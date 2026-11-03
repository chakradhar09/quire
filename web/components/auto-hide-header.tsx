"use client";
// The landing page's header (AppHeader autohide). It stays out of the way while the hero is on screen, since
// the hero has its own "Check a draft", and fades in once the hero has scrolled away. Tabbing into it shows it
// (see .autohide-header in globals.css).
import { useEffect, useState, type ReactNode } from "react";

export function AutoHideHeader({ hero, children }: { hero: string; children: ReactNode }) {
  const [overHero, setOverHero] = useState(true); // hidden from the first paint, no flash

  useEffect(() => {
    const heroEl = document.getElementById(hero);
    if (!heroEl) return;
    // The top 56px (the header's height) does not count as on screen.
    const io = new IntersectionObserver(([e]) => setOverHero(e.isIntersecting), { rootMargin: "-56px 0px 0px 0px" });
    io.observe(heroEl);
    return () => io.disconnect();
  }, [hero]);

  return (
    <header data-hidden={overHero || undefined} className="autohide-header z-30 bg-shell text-on-shell">
      {children}
    </header>
  );
}
