"use client";
import { useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui";
import { retry } from "./actions";

// S03 row and S07 failed state: run a failed similarity check again.
export function RetryButton({ reportId, title }: { reportId: number; title?: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button variant={title ? "ghost" : "secondary"} size="sm" iconOnly={Boolean(title)} loading={pending}
      aria-label={title ? `Retry the check of ${title}` : undefined}
      onClick={() => startTransition(() => retry(reportId))}>
      {title ? !pending && <RotateCcw aria-hidden className="size-4" /> : "Retry the check"}
    </Button>
  );
}
