import { listDrafts } from "@/lib/db";
import { groupPapers } from "@/lib/papers";

// The papers a new draft could join, newest first, for the paper picker. Call after connection().
export const paperChoices = () => groupPapers(listDrafts()).map((p) => ({ id: p.id, title: p.title }));
