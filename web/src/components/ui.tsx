// Shared marks + line icons for TulipGlam (Blanc Tulipe).
// Icons are 24px line, currentColor — set colour/size via className.

export function TulipMark({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 66" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M24 8 C27.5 15 28.5 21 24 28 C19.5 21 20.5 15 24 8 Z" />
      <path d="M24 28 C17 23 13.5 15 15.5 9.5 C20 12 22.5 19 24 28 Z" />
      <path d="M24 28 C31 23 34.5 15 32.5 9.5 C28 12 25.5 19 24 28 Z" />
      <path d="M24 28 L24 56" />
      <path d="M24 41 C30 41 34.5 45 35 55" />
      <path d="M24 45 C18 45 13.5 49 13 57" />
    </svg>
  );
}

// Wordmark: the tulip mark + "TulipGlam" set in the grotesque, bold.
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <TulipMark className="h-6 w-6 text-plum" />
      <span className="text-[1.35rem] font-extrabold leading-none tracking-[-0.02em] text-ink">
        Tulip<span className="text-plum">Glam</span>
      </span>
    </span>
  );
}

type IconProps = { className?: string };
const S = ({ className = "h-5 w-5", children }: IconProps & { children: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    {children}
  </svg>
);

export const SearchIcon = (p: IconProps) => (<S {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" /></S>);
export const HeartIcon = (p: IconProps) => (<S {...p}><path d="M12 20S3.5 14.5 3.5 8.9C3.5 6 5.7 4 8.2 4c1.7 0 3 .9 3.8 2.1C12.8 4.9 14.1 4 15.8 4 18.3 4 20.5 6 20.5 8.9 20.5 14.5 12 20 12 20Z" /></S>);
export const HeartFill = ({ className = "h-5 w-5" }: IconProps) => (<svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true"><path d="M12 20S3.5 14.5 3.5 8.9C3.5 6 5.7 4 8.2 4c1.7 0 3 .9 3.8 2.1C12.8 4.9 14.1 4 15.8 4 18.3 4 20.5 6 20.5 8.9 20.5 14.5 12 20 12 20Z" /></svg>);
export const BagIcon = (p: IconProps) => (<S {...p}><path d="M6 8h12l-1 12H7L6 8Z" /><path d="M9 8V6.5a3 3 0 0 1 6 0V8" /></S>);
export const MenuIcon = (p: IconProps) => (<S {...p}><path d="M4 7h16M4 12h16M4 17h16" /></S>);
export const HomeIcon = (p: IconProps) => (<S {...p}><path d="M4 11.5 12 4l8 7.5" /><path d="M6 10v10h12V10" /></S>);
export const GridIcon = (p: IconProps) => (<S {...p}><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></S>);
export const BoxIcon = (p: IconProps) => (<S {...p}><path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z" /><path d="M3.5 7.5 12 12l8.5-4.5M12 21v-9" /></S>);
export const UserIcon = (p: IconProps) => (<S {...p}><circle cx="12" cy="8" r="3.6" /><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" /></S>);
export const StarIcon = ({ className = "h-4 w-4" }: IconProps) => (<svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17.9 6.8 20.6l1-5.8L3.5 9.7l5.9-.9L12 3.5Z" /></svg>);
export const ArrowRight = ({ className = "h-4 w-4" }: IconProps) => (<S className={className}><path d="M5 12h14M13 6l6 6-6 6" /></S>);
export const ArrowLeft = ({ className = "h-4 w-4" }: IconProps) => (<S className={className}><path d="M19 12H5M11 6l-6 6 6 6" /></S>);
export const ChevronRight = ({ className = "h-4 w-4" }: IconProps) => (<S className={className}><path d="M9 6l6 6-6 6" /></S>);
export const ChevronDown = ({ className = "h-4 w-4" }: IconProps) => (<S className={className}><path d="M6 9l6 6 6-6" /></S>);
export const CloseIcon = (p: IconProps) => (<S {...p}><path d="M6 6l12 12M18 6 6 18" /></S>);
export const CheckIcon = (p: IconProps) => (<S {...p}><path d="M5 12.5l4.5 4.5L19 6.5" /></S>);
export const PlusIcon = (p: IconProps) => (<S {...p}><path d="M12 5v14M5 12h14" /></S>);
export const MinusIcon = (p: IconProps) => (<S {...p}><path d="M5 12h14" /></S>);
export const TrashIcon = (p: IconProps) => (<S {...p}><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" /></S>);
export const FilterIcon = (p: IconProps) => (<S {...p}><path d="M4 6h16M7 12h10M10 18h4" /></S>);
export const TruckIcon = (p: IconProps) => (<S {...p}><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7" /><circle cx="7" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></S>);
export const PlayIcon = (p: IconProps) => (<S {...p}><path d="M8 5.5v13l10-6.5-10-6.5Z" /></S>);
export const WhatsAppIcon = ({ className = "h-5 w-5" }: IconProps) => (<svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.5 15.2L2 22l4.9-1.5A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-4-4.6-4.2-.1-.2-1.1-1.4-1.1-2.7s.7-1.9.9-2.2c.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 1.9c.1.2.1.4 0 .6l-.4.6c-.2.2-.3.4-.1.7.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.2.1.4.1.6-.1l.7-.9c.2-.2.4-.2.6-.1l1.8.9c.3.1.5.2.5.4.1.2.1.8-.1 1.3Z" /></svg>);
export const InstagramIcon = ({ className = "h-5 w-5" }: IconProps) => (<S className={className}><rect x="3.5" y="3.5" width="17" height="17" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17" cy="7" r="1" fill="currentColor" stroke="none" /></S>);

export function Stars({ rating, className = "h-4 w-4" }: { rating: number; className?: string }) {
  return (
    <span className="inline-flex gap-0.5 text-plum" aria-label={`${rating} out of 5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <StarIcon key={i} className={`${className} ${i < Math.round(rating) ? "" : "text-line-strong"}`} />
      ))}
    </span>
  );
}

export function Spinner({ className = "h-6 w-6" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={`animate-spin ${className}`} fill="none" aria-label="Loading">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" className="opacity-20" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
