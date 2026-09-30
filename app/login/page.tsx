// Password gate's sign-in page. A plain form POST to /api/login, so it works
// before any client JS has loaded.
import { Suspense } from "react";
import { safeNext } from "../../lib/site-auth.ts";

export const metadata = { title: "Sign in · cbio-lab" };

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<LoginForm next="/" failed={false} />}>
      <LoginFromParams searchParams={searchParams} />
    </Suspense>
  );
}

async function LoginFromParams({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  return <LoginForm next={safeNext(Array.isArray(sp.next) ? sp.next[0] : sp.next)} failed={sp.error !== undefined} />;
}

function LoginForm({ next, failed }: { next: string; failed: boolean }) {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "var(--s4)" }}>
      <form method="post" action="/api/login"
        style={{ width: "100%", maxWidth: "20rem", display: "grid", gap: "var(--s3)", background: "var(--card)",
                 border: "1px solid var(--line)", borderRadius: "var(--r-lg)", padding: "var(--s5)" }}>
        <h1 style={{ fontSize: "var(--t-xl)", margin: 0 }}>cbio-lab</h1>
        <label htmlFor="password" style={{ color: "var(--muted)", fontSize: "var(--t-md)" }}>Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" autoFocus required
          style={{ font: "inherit", padding: "var(--s2) var(--s3)", border: "1px solid var(--line)",
                   borderRadius: "var(--r-md)", background: "var(--paper)", color: "var(--ink)" }} />
        <input type="hidden" name="next" value={next} />
        {failed && <p role="alert" style={{ margin: 0, color: "var(--err)", fontSize: "var(--t-md)" }}>Wrong password.</p>}
        <button type="submit"
          style={{ font: "inherit", padding: "var(--s2) var(--s3)", border: 0, borderRadius: "var(--r-md)",
                   background: "var(--accent)", color: "#fff", cursor: "pointer" }}>Sign in</button>
      </form>
    </main>
  );
}
