import { cloneElement, useId, useState } from "react";
import { EyeIcon, EyeOffIcon } from "./ui";

/**
 * A labelled form field.
 *
 * Every form on this site used a placeholder as its label. A placeholder disappears the moment
 * you type, so anyone checking their own work — or returning to a half-filled checkout — sees
 * unlabelled boxes, and a screen reader gets no reliable name for the control at all. On the
 * one form that matters most, checkout, that meant re-reading your own answers to work out
 * which box was the phone number.
 *
 * The id and the description are wired here so no caller can forget them.
 */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactElement<React.InputHTMLAttributes<HTMLInputElement | HTMLTextAreaElement>>;
}) {
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
 * button reports its state with `aria-pressed` rather than only swapping an icon, and the input
 * keeps its autocomplete hint so password managers still fill it.
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
