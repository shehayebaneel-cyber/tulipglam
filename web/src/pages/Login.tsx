import { cloneElement, useId, useState } from "react";
import { Button } from "../components/Button";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useStore } from "../lib/store";
import { TulipMark, EyeIcon, EyeOffIcon } from "../components/ui";

/** Matches the server's rule so the requirement is stated before the form is rejected. */
const MIN_PASSWORD = 6;

export function Login({ mode }: { mode: "login" | "register" }) {
  const isRegister = mode === "register";
  const { login, register } = useStore();
  const navigate = useNavigate();
  const back = (useLocation().state as { from?: string })?.from ?? "/account";

  const [f, setF] = useState({ fullName: "", email: "", phone: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      if (isRegister) await register({ fullName: f.fullName, email: f.email, password: f.password, phone: f.phone });
      else await login(f.email, f.password);
      navigate(back, { replace: true });
    } catch (e2) { setErr((e2 as Error).message); setBusy(false); }
  };

  return (
    <div className="wrap grid min-h-[70vh] place-items-center py-12">
      <div className="w-full max-w-sm">
        <div className="text-center">
          <TulipMark className="mx-auto h-9 w-9 text-plum" />
          <h1 className="serif mt-3 text-3xl font-medium text-ink">{isRegister ? "Create your account" : "Welcome back"}</h1>
          <p className="mt-1.5 text-sm text-muted">{isRegister ? "Save your details for faster checkout and order history." : "Sign in to see your orders and saved addresses."}</p>
        </div>
        {/* Every field has a real <label>. They were placeholder-only, which disappears the
            moment you type — so anyone checking their work saw unlabelled boxes. */}
        <form onSubmit={submit} className="mt-6 space-y-3.5 rounded-2xl border border-line bg-surface p-6">
          {isRegister && (
            <Field label="Full name">
              <input required value={f.fullName} onChange={set("fullName")} autoComplete="name" className="field focus-ring" />
            </Field>
          )}
          <Field label="Email">
            <input required type="email" value={f.email} onChange={set("email")} autoComplete="email" className="field focus-ring" />
          </Field>
          {isRegister && (
            <Field label="Phone" hint="Optional — we use it to reach you about an order">
              <input value={f.phone} onChange={set("phone")} inputMode="tel" autoComplete="tel" className="field focus-ring" />
            </Field>
          )}
          <PasswordField
            label="Password"
            hint={isRegister ? `At least ${MIN_PASSWORD} characters` : undefined}
            value={f.password}
            onChange={set("password")}
            autoComplete={isRegister ? "new-password" : "current-password"}
            minLength={isRegister ? MIN_PASSWORD : undefined}
          />
          {!isRegister && (
            <p className="text-right">
              <Link to="/forgot-password" className="focus-ring rounded text-[12px] font-semibold text-plum hover:underline">Forgot your password?</Link>
            </p>
          )}
          {err && <p role="alert" className="rounded-lg bg-sale/10 px-3 py-2 text-[12px] text-sale">{err}</p>}
          <Button type="submit" disabled={busy} variant="primary" size="lg" full>{busy ? "Please wait…" : isRegister ? "Create account" : "Sign in"}</Button>
        </form>
        <p className="mt-4 text-center text-[13px] text-muted">
          {isRegister ? <>Already have an account? <Link to="/login" className="font-semibold text-plum hover:underline">Sign in</Link></>
            : <>New to TulipGlam? <Link to="/register" className="font-semibold text-plum hover:underline">Create an account</Link></>}
        </p>
        <p className="mt-2 text-center text-[12px] text-muted">or just <Link to="/shop" className="underline hover:text-plum">continue as a guest</Link></p>
      </div>
    </div>
  );
}

/** Labelled field. The id and description are wired here so no caller can forget them. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactElement<React.InputHTMLAttributes<HTMLInputElement>> }) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[12px] font-semibold text-ink">{label}</label>
      {cloneElement(children, { id, ...(hint ? { "aria-describedby": hintId } : {}) })}
      {hint && <p id={hintId} className="mt-1 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

/**
 * Password input with a show/hide toggle.
 *
 * Typing a password blind on a phone keyboard is where most failed sign-ins come from. The
 * button reports its state with `aria-pressed` rather than only swapping an icon, and the
 * input keeps its autocomplete hint so password managers still fill it.
 */
export function PasswordField({
  label, hint, value, onChange, autoComplete, minLength,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  autoComplete: string;
  minLength?: number;
}) {
  const [shown, setShown] = useState(false);
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[12px] font-semibold text-ink">{label}</label>
      <div className="relative">
        <input
          id={id} required type={shown ? "text" : "password"} value={value} onChange={onChange}
          autoComplete={autoComplete} minLength={minLength}
          aria-describedby={hint ? hintId : undefined}
          className="field focus-ring w-full pr-11"
        />
        <button
          type="button" onClick={() => setShown((s) => !s)} aria-pressed={shown}
          aria-label={shown ? "Hide password" : "Show password"}
          className="focus-ring absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-muted hover:text-ink"
        >
          {shown ? <EyeOffIcon className="h-[18px] w-[18px]" /> : <EyeIcon className="h-[18px] w-[18px]" />}
        </button>
      </div>
      {hint && <p id={hintId} className="mt-1 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}
