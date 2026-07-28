import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useStore } from "../lib/store";
import { TulipMark } from "../components/ui";

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
        <form onSubmit={submit} className="mt-6 space-y-3 rounded-2xl border border-line bg-surface p-6">
          {isRegister && <input required placeholder="Full name" value={f.fullName} onChange={set("fullName")} className="field" />}
          <input required type="email" placeholder="Email" value={f.email} onChange={set("email")} className="field" />
          {isRegister && <input placeholder="Phone (optional)" value={f.phone} onChange={set("phone")} inputMode="tel" className="field" />}
          <input required type="password" placeholder="Password" value={f.password} onChange={set("password")} className="field" />
          {err && <p className="rounded-lg bg-sale/10 px-3 py-2 text-[12px] text-sale">{err}</p>}
          <button disabled={busy} className="btn btn-ink w-full py-3.5">{busy ? "Please wait…" : isRegister ? "Create account" : "Sign in"}</button>
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
