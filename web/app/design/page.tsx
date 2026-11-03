import { notFound } from "next/navigation";
import { DesignSystem } from "./design-system";

// The design system check is a tool for working on Quire, not part of the app: only the dev server serves it.
export default function DesignPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DesignSystem />;
}
