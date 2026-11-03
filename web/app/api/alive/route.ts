import { pageSeen } from "@/lib/alive";

// An open page checking in (components/keep-alive.tsx), so Quire keeps running while one is open (lib/alive.ts).
export function POST() {
  pageSeen();
  return new Response(null, { status: 204 });
}
