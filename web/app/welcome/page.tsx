import { redirect } from "next/navigation";

// The landing page moved to `/`; old links to /welcome still arrive there.
export default function Welcome() {
  redirect("/");
}
