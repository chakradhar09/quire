"use client";
import { useTransition } from "react";
import { MoreHorizontal } from "lucide-react";
import { Menu, type MenuItem } from "@/components/overlays";
import { Button, exhibit } from "@/components/ui";
import { shortTitle } from "@/lib/papers";
import { movePaper } from "./actions";

// S03 row action: move a version into another paper, or take it out into a paper of its own.
export function VersionMenu({ id, title, others, inChain }: {
  id: number; title: string; others: { id: number; title: string }[]; inChain: boolean;
}) {
  const [pending, startTransition] = useTransition();
  // The menu never offers the version's own paper, the only move the database refuses.
  const run = (paper: number | null) => startTransition(async () => { await movePaper(id, paper); });
  const items: MenuItem[] = [
    ...others.map((p) => ({ label: `Move to ${shortTitle(p.title, 32)} (${exhibit(p.id)})`, onSelect: () => run(p.id) })),
    ...(inChain ? [{ label: "Make it a paper of its own", onSelect: () => run(null) }] : []),
  ];
  if (!items.length) return null;
  return (
    <Menu items={items} trigger={
      <Button variant="ghost" size="sm" iconOnly loading={pending} aria-label={`Move ${title} to a paper`}>
        {!pending && <MoreHorizontal aria-hidden className="size-4" />}
      </Button>
    } />
  );
}
