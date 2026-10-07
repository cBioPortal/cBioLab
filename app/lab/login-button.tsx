"use client";
// Top-right "Log in" / "Log out", like the portal's. There is one shared login for now: the
// deployment's password (LOGIN_PASSWORD), which unlocks saved cohorts, analyses and custom data. Shown
// only where the deployment has set one.
import { useEffect, useRef, useState } from "react";
import { loadCustomData, logIn, logOut, onLoginRequest } from "./custom-data-client.ts";
import { useCustomDataState } from "./custom-data-panel.tsx";

export default function LoginButton() {
  const server = useCustomDataState();
  const ref = useRef<HTMLDialogElement | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const open = () => { setErr(null); setPassword(""); ref.current?.showModal(); };
  // whether this deployment has a login, and whether this browser is in (once per page)
  useEffect(() => { loadCustomData(); return onLoginRequest(open); }, []);
  if (!server.enabled) return null;

  const submit = async () => {
    setBusy(true); setErr(null);
    try { await logIn(password); ref.current?.close(); }
    catch (e) { setErr(String((e as Error).message || e)); }
    finally { setBusy(false); }
  };

  return (
    <>
      {server.unlocked
        ? <span className="loginstate"><span className="meta">Signed in</span>
            <button className="tbbtn" onClick={() => logOut()} title="sign this browser out: custom data stops being readable here">Log out</button></span>
        : <button className="tbbtn" onClick={open} title="log in to see, add and use custom data">Log in</button>}
      <dialog ref={ref} className="namedialog logindialog" onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
        <form method="dialog" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <h3>Log in</h3>
          <span className="meta">One shared login for now. It lets you save and open cohorts and analyses and use custom data; everyone who logs in sees the same things.</span>
          <input type="password" placeholder="password" value={password} autoFocus autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)} />
          {err && <p className="error" style={{ margin: "var(--s2) 0 0" }}>{err}</p>}
          <div className="row" style={{ justifyContent: "flex-end", marginTop: "var(--s3)" }}>
            <button type="button" className="linklike" onClick={() => ref.current?.close()}>cancel</button>
            <button type="submit" className="primary" disabled={!password || busy}>{busy ? "logging in…" : "Log in"}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
