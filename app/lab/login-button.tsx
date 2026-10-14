"use client";
// Top-right "Log in" / "Log out", like the portal's. There is one shared login for now: the
// deployment's password (LOGIN_PASSWORD), which unlocks saved cohorts, analyses and custom data. Shown
// only where the deployment has set one.
import { useEffect, useState } from "react";
import { LogIn, LogOut } from "lucide-react";
import { loadCustomData, logIn, logOut, onLoginRequest } from "./custom-data-client.ts";
import { useCustomDataState } from "./custom-data-panel.tsx";
import { Button } from "../_ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../_ui/dialog";
import { Input } from "../_ui/input";
import { TB } from "../_ui/toolbar.ts";

export default function LoginButton() {
  const server = useCustomDataState();
  const [shown, setShown] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const open = () => { setErr(null); setPassword(""); setShown(true); };
  // whether this deployment has a login, and whether this browser is in (once per page)
  useEffect(() => { void loadCustomData(); return onLoginRequest(open); }, []);
  if (!server.enabled) return null;

  const submit = async () => {
    setBusy(true); setErr(null);
    try { await logIn(password); setShown(false); }
    catch (e) { setErr(String((e as Error).message || e)); }
    finally { setBusy(false); }
  };

  return (
    <>
      {server.unlocked
        ? <span className="loginstate"><span className="meta">Signed in</span>
            <Button variant="outline" size="sm" className={TB} onClick={() => logOut()} title="sign this browser out: custom data stops being readable here"><LogOut />Log out</Button></span>
        : <Button variant="outline" size="sm" className={TB} onClick={open} title="log in to see, add and use custom data"><LogIn />Log in</Button>}
      <Dialog open={shown} onOpenChange={setShown}>
        <DialogContent className="logindialog sm:max-w-sm">
          <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="flex flex-col gap-3">
            <DialogHeader>
              <DialogTitle className="text-base">Log in</DialogTitle>
              <DialogDescription className="text-md">One shared login for now. It lets you save and open cohorts and analyses and use custom data; everyone who logs in sees the same things.</DialogDescription>
            </DialogHeader>
            <Input type="password" placeholder="password" value={password} autoFocus autoComplete="current-password"
              className="h-9 text-md md:text-md" onChange={(e) => setPassword(e.target.value)} />
            {err && <p className="error m-0">{err}</p>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setShown(false)}>Cancel</Button>
              <Button type="submit" disabled={!password || busy}>{busy ? "logging in…" : "Log in"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
