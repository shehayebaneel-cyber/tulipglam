import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, waHref, WA_UNSET_HELP, setToken } from "../lib/api";
import { useStore } from "../lib/store";
import { Button, ButtonAnchor } from "../components/Button";
import { TulipMark } from "../components/ui";
import { Field, PasswordField } from "./Login";

const MIN_PASSWORD = 6;

function Shell({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="wrap grid min-h-[70vh] place-items-center py-12">
      <div className="w-full max-w-sm">
        <div className="text-center">
          <TulipMark className="mx-auto h-9 w-9 text-plum" />
          <h1 className="serif mt-3 text-3xl font-medium text-ink">{title}</h1>
          <p className="mt-1.5 text-sm text-muted">{sub}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Request a reset link.
 *
 * Offered only when the store can actually send email. Everything else in this app degrades
 * quietly without SMTP because WhatsApp carries the conversation — a reset has no such
 * fallback, so a form that silently sends nothing would be worse than no form at all. When
 * mail is not configured this says so and points at the channel that does work.
 */
export function ForgotPassword() {
  const { site } = useStore();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");

  const emailWorks = site?.settings.emailConfigured === "true";
  const wa = waHref(site?.settings.whatsappNumber, "Hi, I can't sign in to my TulipGlam account.");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try { await api.forgotPassword(email); setSent(true); }
    catch (e2) { setErr((e2 as Error).message); }
    finally { setBusy(false); }
  };

  if (!site) return <Shell title="Reset your password" sub="One moment…"><div /></Shell>;

  if (!emailWorks) {
    return (
      <Shell title="Reset your password" sub="We can’t email a reset link yet.">
        <div className="mt-6 space-y-4 rounded-2xl border border-line bg-surface p-6 text-[13px] text-ink/85">
          <p>Automatic password reset needs an email account connected to the store, and that isn’t set up yet.</p>
          <p>Message us and we’ll get you back into your account.</p>
          <ButtonAnchor href={wa} title={wa ? undefined : WA_UNSET_HELP} variant="primary" size="lg" full>Message us on WhatsApp</ButtonAnchor>
          <p className="text-center text-[12px] text-muted">
            You can still <Link to="/track" className="font-semibold text-plum hover:underline">track an order</Link> without signing in.
          </p>
        </div>
        <p className="mt-4 text-center text-[13px] text-muted"><Link to="/login" className="font-semibold text-plum hover:underline">Back to sign in</Link></p>
      </Shell>
    );
  }

  if (sent) {
    return (
      <Shell title="Check your email" sub={`If ${email} has an account, a reset link is on its way.`}>
        <div className="mt-6 space-y-3 rounded-2xl border border-line bg-surface p-6 text-[13px] text-ink/85">
          {/* Deliberately does not confirm whether the address is registered — that would turn
              this page into a way to test which addresses have accounts. */}
          <p>The link works once and expires in 30 minutes.</p>
          <p className="text-muted">Nothing after a few minutes? Check the spam folder, then try again.</p>
          <Button onClick={() => { setSent(false); setEmail(""); }} variant="secondary" full>Use a different email</Button>
        </div>
        <p className="mt-4 text-center text-[13px] text-muted"><Link to="/login" className="font-semibold text-plum hover:underline">Back to sign in</Link></p>
      </Shell>
    );
  }

  return (
    <Shell title="Reset your password" sub="We’ll email you a link to choose a new one.">
      <form onSubmit={submit} className="mt-6 space-y-3.5 rounded-2xl border border-line bg-surface p-6">
        <Field label="Email">
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className="field focus-ring" />
        </Field>
        {err && <p role="alert" className="rounded-lg bg-sale/10 px-3 py-2 text-[12px] text-sale">{err}</p>}
        <Button type="submit" disabled={busy} variant="primary" size="lg" full>{busy ? "Sending…" : "Send reset link"}</Button>
      </form>
      <p className="mt-4 text-center text-[13px] text-muted"><Link to="/login" className="font-semibold text-plum hover:underline">Back to sign in</Link></p>
    </Shell>
  );
}

/** Consume a reset link and set a new password. */
export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { setCustomer } = useStore();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    // Checked here as well as by the server: catching it before the round trip means the
    // token isn't spent on a typo, and it can only be used once.
    if (password !== confirm) { setErr("The two passwords don’t match."); return; }
    if (password.length < MIN_PASSWORD) { setErr(`Password must be at least ${MIN_PASSWORD} characters.`); return; }
    setBusy(true);
    try {
      const r = await api.resetPassword(token, password);
      setToken(r.token);
      setCustomer(r.customer);
      navigate("/account", { replace: true });
    } catch (e2) { setErr((e2 as Error).message); setBusy(false); }
  };

  if (!token) {
    return (
      <Shell title="This link is incomplete" sub="The reset link is missing its token — it may have been cut short by an email client.">
        <div className="mt-6 rounded-2xl border border-line bg-surface p-6">
          <Link to="/forgot-password" className="btn btn-ink w-full py-3">Request a new link</Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title="Choose a new password" sub="You’ll be signed in straight away.">
      <form onSubmit={submit} className="mt-6 space-y-3.5 rounded-2xl border border-line bg-surface p-6">
        <PasswordField label="New password" hint={`At least ${MIN_PASSWORD} characters`} value={password}
          onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={MIN_PASSWORD} />
        <PasswordField label="Confirm new password" value={confirm}
          onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={MIN_PASSWORD} />
        {err && <p role="alert" className="rounded-lg bg-sale/10 px-3 py-2 text-[12px] text-sale">{err}</p>}
        <Button type="submit" disabled={busy} variant="primary" size="lg" full>{busy ? "Saving…" : "Save and sign in"}</Button>
        <p className="text-center text-[12px] text-muted">
          Link expired? <Link to="/forgot-password" className="font-semibold text-plum hover:underline">Request a new one</Link>
        </p>
      </form>
    </Shell>
  );
}
