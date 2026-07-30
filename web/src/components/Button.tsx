import { Link } from "react-router-dom";

/**
 * The one button in the app.
 *
 * Before this existed, `btn-ink` (black) was used 32 times across 20 files for primary
 * actions — the login "Sign in", the wishlist "Explore products", the admin "New product" —
 * and black is not in Blanc Tulipe. WhatsApp CTAs were #25D366, which made the loudest
 * element on the site a colour from someone else's brand.
 *
 * Variants:
 *   primary     plum fill — the one obvious action on a screen
 *   secondary   plum outline — a real alternative
 *   tertiary    quiet, bordered — "Cancel", "Back"
 *   destructive sale red, reserved for deletion (the only non-price use of that colour,
 *               because a destructive action genuinely needs the same alarm level)
 */
export type ButtonVariant = "primary" | "secondary" | "tertiary" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-plum text-white hover:bg-plum-dark border-transparent",
  secondary: "bg-surface text-plum border-plum hover:bg-plum-soft",
  tertiary: "bg-surface text-ink border-line-strong hover:border-ink",
  destructive: "bg-sale text-white hover:brightness-95 border-transparent",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "px-3.5 py-2 text-[12px]",
  md: "px-5 py-2.5 text-[13px]",
  // 48px tall: comfortably above the 44px minimum touch target at 390px
  lg: "px-7 py-3.5 text-[13px]",
};

type Common = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
  uppercase?: boolean;
  children: React.ReactNode;
  className?: string;
};

const classesFor = ({ variant = "primary", size = "md", full, uppercase, className = "" }: Common) =>
  [
    "inline-flex items-center justify-center gap-2 rounded-full border font-semibold",
    "transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum",
    "disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
    "active:translate-y-[0.5px]",
    VARIANT[variant],
    SIZE[size],
    full ? "w-full" : "",
    uppercase ? "uppercase tracking-[0.12em] text-[12px]" : "",
    className,
  ].filter(Boolean).join(" ");

export function Button({
  type = "button",
  onClick,
  disabled,
  title,
  ...rest
}: Common & {
  type?: "button" | "submit";
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} className={classesFor(rest)}>
      {rest.children}
    </button>
  );
}

/** Same styling for internal navigation. */
export function ButtonLink({ to, ...rest }: Common & { to: string }) {
  return <Link to={to} className={classesFor(rest)}>{rest.children}</Link>;
}

/**
 * External link, or a disabled-looking span when `href` is empty. Used for WhatsApp CTAs:
 * with no usable number we must render something inert with an explanation rather than a
 * `wa.me` link that goes nowhere.
 */
export function ButtonAnchor({
  href,
  title,
  ...rest
}: Common & { href: string; title?: string }) {
  if (!href) {
    return (
      <span role="link" aria-disabled="true" title={title} className={classesFor(rest)}>
        {rest.children}
      </span>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" title={title} className={classesFor(rest)}>
      {rest.children}
    </a>
  );
}
