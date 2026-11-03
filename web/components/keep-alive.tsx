"use client";
// Tells the server a Quire page is open, now and every TICK_MS, so it stops by itself only once every tab is
// closed (lib/alive.ts). Browsers slow timers in background tabs to about once a minute, well inside IDLE_MS.
import { useEffect } from "react";

const TICK_MS = 30_000; // lib/alive.ts's TICK_MS (that module is server-only)

export function KeepAlive() {
  useEffect(() => {
    const ping = () => { fetch("/api/alive", { method: "POST", keepalive: true }).catch(() => {}); };
    ping();
    const timer = setInterval(ping, TICK_MS);
    const onShow = () => { if (document.visibilityState === "visible") ping(); };
    document.addEventListener("visibilitychange", onShow);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onShow); };
  }, []);
  return null;
}
