import { NextResponse, type NextRequest } from "next/server";

// The app has no auth: listening on 127.0.0.1 is the lock. A website you visit could still reach
// it through DNS rebinding (its own hostname resolving to 127.0.0.1), and then Origin and Host
// match each other, so Next's server action check passes. Only these Host headers get through.
const ALLOWED_HOSTS = new Set(["localhost:3000", "127.0.0.1:3000", "[::1]:3000"]);

export function proxy(request: NextRequest) {
  if (!ALLOWED_HOSTS.has(request.headers.get("host") ?? "")) {
    return new NextResponse("Forbidden: Quire only answers on localhost.", { status: 403 });
  }
  return NextResponse.next();
}
