"use client";
// Re-renders the page from the server every 3 s while something on it is unfinished. Pages read the
// database per request, so this is the whole live-status mechanism: no status API to keep in sync.
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}
