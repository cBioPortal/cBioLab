// The commit this deployment was built from (lib/build-info.ts), so a script can ask a running
// server what code it is: `curl <host>/api/version`.
import { BUILD_INFO } from "../../../lib/build-info.ts";

export function GET() {
  return Response.json(BUILD_INFO);
}
