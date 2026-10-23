// The NEW mark after a view kind's name: kinds cBioPortal has no counterpart for (lib/new-in-lab.ts).
import { NEW_TITLE } from "../../lib/new-in-lab.ts";

export function NewMark() {
  return <span className="ml-1 text-xs font-semibold tracking-wide text-ok" title={NEW_TITLE}>NEW</span>;
}
