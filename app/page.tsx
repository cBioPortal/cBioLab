// The root route. The standalone "query builder" UI that used to live here
// (v1 recipes, treatment-line explorer) has been retired in favour of the
// Analysis app, which subsumes it — Explore/Cohorts/Analysis/Chat/Examples
// are all reachable from there. Redirect rather than 404 so old links and
// bookmarks still land somewhere useful.
import { redirect } from "next/navigation";

export const instant = false;

export default function RootPage() {
  redirect("/lab");
}
