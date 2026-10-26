// Groups are managed with the rest of the reader's saved work; old links land on that tab.
import { redirect } from "next/navigation";

export default function GroupsPage() {
  redirect("/saved?tab=groups");
}
