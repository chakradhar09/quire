"use client";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { usePendingDeletes } from "./pending-deletes";

// S03 row action: delete a draft. No confirm: the toast that follows offers Undo before anything is deleted.
export function DeleteDraft({ id, title }: { id: number; title: string }) {
  const { remove } = usePendingDeletes();
  return (
    <Button variant="ghost" size="sm" iconOnly aria-label={`Delete ${title}`} onClick={() => remove(id, title)}>
      <Trash2 aria-hidden className="size-4" />
    </Button>
  );
}
