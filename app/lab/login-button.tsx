"use client";
// Top-right "Sign in", or once signed in the account menu (who, Admin for an administrator, and sign
// out), like the portal's "Logged in as" menu. Signing in lets a
// reader save and open their own cohorts and analyses and use custom data (lib/auth.ts). A
// deployment offers its provider (Google, MSK…), the development sign-in, or both; with only a
// provider the button goes straight there. Shown only where the deployment signs people in, and
// where the check of that failed: it then asks again when clicked, and says why if it still can't.
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, LogIn, LogOut, Settings, UserRound } from "lucide-react";
import { loadCustomData, loadServerData, devSignIn, signInWithProvider, logOut, onLoginRequest, serverState } from "./custom-data-client.ts";
import { useCustomDataState } from "./custom-data-panel.tsx";
import { Button } from "../_ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../_ui/dialog";
import { Input } from "../_ui/input";
import { TB } from "../_ui/toolbar.ts";
import { GearMenu, MenuItem, MenuSeparator } from "../_ui/gear-menu.tsx";

export default function LoginButton() {
  const server = useCustomDataState();
  const [shown, setShown] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const showDialog = useCallback((why: string | null = null) => { setErr(why); setEmail(""); setShown(true); }, []);
  const open = useCallback(async () => {
    if (serverState().authError) await loadServerData();
    const { enabled, authError, options } = serverState();
    if (authError) showDialog("Could not check how this site signs you in: " + authError);
    else if (!enabled) return;
    else if (options.oidc && !options.dev) signInWithProvider();
    else showDialog();
  }, [showDialog]);
  // whether this deployment signs people in, and who is signed in here (once per page); a sign-in
  // the provider sent back refused arrives as ?signin_error=, shown in the dialog once it renders
  useEffect(() => {
    void loadCustomData();
    const u = new URL(location.href), why = u.searchParams.get("signin_error");
    if (why) {
      u.searchParams.delete("signin_error");
      history.replaceState(history.state, "", u.pathname + u.search + u.hash);
      showDialog(why);
    }
    return onLoginRequest(() => void open());
  }, [open, showDialog]);
  if (!server.enabled && !server.authError) return null;

  const submit = async () => {
    setBusy(true); setErr(null);
    try { await devSignIn(email); setShown(false); }
    catch (e) { setErr(String((e as Error).message || e)); }
    finally { setBusy(false); }
  };
  const who = server.user?.name || server.user?.email;

  return (
    <>
      {server.unlocked
        ? <span className="loginstate">
            <GearMenu menuId="account" className="accountbtn" title={"signed in as " + server.user?.email}
              label={<><UserRound /><span className="meta">{who}</span><ChevronDown /></>}>
              {(close) => <>
                <div className="px-2 py-1">
                  <div>{server.user?.name || "Signed in"}</div>
                  <div className="meta">{server.user?.email}</div>
                </div>
                <MenuSeparator />
                {server.user?.admin && <MenuItem asChild onClick={close}><a href="/admin" data-tip="clear the result cache, see and change the federation settings"><Settings />Admin</a></MenuItem>}
                <MenuItem onClick={() => { close(); void logOut(); }}><LogOut />Sign out</MenuItem>
              </>}
            </GearMenu></span>
        : <Button variant="outline" size="sm" className={TB} onClick={() => void open()} data-tip="sign in to save cohorts and analyses and use custom data"><LogIn />Sign in</Button>}
      <Dialog open={shown} onOpenChange={setShown}>
        <DialogContent className="logindialog sm:max-w-sm">
          <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="flex flex-col gap-3">
            <DialogHeader>
              <DialogTitle className="text-base">Sign in</DialogTitle>
              <DialogDescription className="text-md">Signing in lets you save and open your own cohorts and analyses, and use custom data.</DialogDescription>
            </DialogHeader>
            {err && <p className="error m-0">{err}</p>}
            {server.options.oidc && (
              <Button type="button" className="self-start" onClick={signInWithProvider}>Sign in with {server.options.oidc}</Button>)}
            {server.options.dev && <>
              <p className="meta m-0">Development sign-in: any email, no password. This deployment is not for real data.</p>
              <Input type="email" placeholder="email" value={email} autoFocus={!server.options.oidc} autoComplete="email"
                className="h-9 text-md md:text-md" onChange={(e) => setEmail(e.target.value)} />
            </>}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setShown(false)}>Cancel</Button>
              {server.options.dev && <Button type="submit" disabled={!email.trim() || busy}>{busy ? "signing in…" : "Sign in"}</Button>}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
