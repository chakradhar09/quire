"use client";
import { useState } from "react";
import { Dropdown } from "@/components/overlays";
import { exhibit, withBreaks } from "@/components/ui";
import { shortTitle, suggestPaper } from "@/lib/papers";

export type PaperChoice = { id: number; title: string };

// Which paper a new draft joins: suggested from its title (the same title once version words like "v3" and
// "final" are dropped), "New paper" otherwise; choosing by hand wins over the suggestion. Submits as `paper`.
export function PaperPicker({ id, papers, title }: { id: string; papers: PaperChoice[]; title: string }) {
  const [picked, setPicked] = useState<string>();
  const suggested = suggestPaper(title, papers);
  const value = picked ?? (suggested === undefined ? "new" : String(suggested));
  const chosen = papers.find((p) => String(p.id) === value);
  return (
    <Dropdown id={id} name="paper" label="Paper" value={value} onValueChange={setPicked}
      hint={chosen
        ? `${picked === undefined ? "Looks like a new version of this paper. " : ""}It becomes the newest version of ${shortTitle(chosen.title, 48)}.`
        : "Starts a paper of its own."}
      groups={[
        { items: [{ value: "new", label: "New paper", detail: "Starts a paper of its own" }] },
        {
          label: "Add as a new version of",
          items: papers.map((p) => ({
            value: String(p.id), label: withBreaks(shortTitle(p.title, 80)), detail: exhibit(p.id),
            tag: p.id === suggested ? "Suggested" : undefined,
          })),
        },
      ]} />
  );
}
