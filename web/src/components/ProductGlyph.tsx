import type { Glyph } from "../lib/api";

// Elegant line silhouettes standing in for product photos in the prototype.
// Rendered on a soft tinted bed; swap for real images when the catalogue lands.
export function ProductGlyph({ kind, className = "" }: { kind: Glyph; className?: string }) {
  return (
    <svg viewBox="0 0 100 120" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === "bottle" && (
        <>
          <path d="M43 20h14v9c9 3 14 9 14 20v41a6 6 0 0 1-6 6H41a6 6 0 0 1-6-6V49c0-11 5-17 14-20v-9Z" />
          <rect x="43" y="12" width="14" height="8" rx="1.5" />
          <path d="M42 70h30" opacity=".5" />
        </>
      )}
      {kind === "dropper" && (
        <>
          <path d="M40 40h20v46a8 8 0 0 1-8 8h-4a8 8 0 0 1-8-8V40Z" />
          <rect x="43" y="18" width="14" height="14" rx="2" />
          <path d="M50 32v8M46 22v-8M54 22v-8" opacity=".55" />
          <path d="M43 74h14" opacity=".5" />
        </>
      )}
      {kind === "jar" && (
        <>
          <path d="M30 58c0-4 3-7 7-7h26c4 0 7 3 7 7v28a8 8 0 0 1-8 8H38a8 8 0 0 1-8-8V58Z" />
          <path d="M34 44h32a5 5 0 0 1 5 5v2H29v-2a5 5 0 0 1 5-5Z" />
        </>
      )}
      {kind === "tube" && (
        <>
          <path d="M38 34h24v52a10 10 0 0 1-10 10h-4a10 10 0 0 1-10-10V34Z" />
          <path d="M38 34c0-3 5-6 12-6s12 3 12 6" />
          <rect x="45" y="14" width="10" height="12" rx="2" />
          <path d="M42 84h16" opacity=".5" />
        </>
      )}
      {kind === "lipstick" && (
        <>
          <path d="M40 56h20v34a6 6 0 0 1-6 6h-8a6 6 0 0 1-6-6V56Z" />
          <path d="M42 56v-8h16v8" />
          <path d="M44 48l6-24 6 24" />
        </>
      )}
      {kind === "compact" && (
        <>
          <rect x="26" y="40" width="48" height="40" rx="10" />
          <path d="M26 60h48" opacity=".55" />
          <circle cx="50" cy="70" r="5" opacity=".55" />
        </>
      )}
      {kind === "mist" && (
        <>
          <path d="M40 44h20v42a8 8 0 0 1-8 8h-4a8 8 0 0 1-8-8V44Z" />
          <rect x="44" y="26" width="12" height="18" rx="1.5" />
          <path d="M56 30h8M56 34h6" opacity=".6" />
          <circle cx="72" cy="24" r="1.4" opacity=".6" />
          <circle cx="78" cy="30" r="1.4" opacity=".5" />
          <circle cx="74" cy="36" r="1.4" opacity=".45" />
        </>
      )}
    </svg>
  );
}
