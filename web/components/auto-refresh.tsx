"use client";
// Re-renders the page from the server every 3 s while something on it is unfinished. Pages read the
// database per request, so this is the whole live-status mechanism: no status API to keep in sync.
// A hidden tab skips the refreshes and catches up once when it is shown again. The report page and the header's
// queue can both be active: they share one 3 s rhythm instead of refreshing twice.
import { useRouter } from "next/navigation";
import { useEffect } from "react";

let last = 0; // when any AutoRefresh on this page last refreshed

export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      if (document.hidden || Date.now() - last < 2500) return;
      last = Date.now();
      router.refresh();
    };
    const timer = setInterval(tick, 3000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [active, router]);
  return null;
}
