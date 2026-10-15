// Writes the public environment variables (lib/public-env.ts) into the page. Read per request —
// connection() keeps it out of the build's prerender — so it must sit inside a Suspense boundary.
import { connection } from "next/server";
import { publicEnv } from "../../lib/public-env.ts";
import { PublicEnvProvider } from "./public-env-context.tsx";

export async function PublicEnv({ children }: { children: React.ReactNode }) {
  await connection();
  return <PublicEnvProvider env={publicEnv()}>{children}</PublicEnvProvider>;
}
