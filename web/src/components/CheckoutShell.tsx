import { Link } from "react-router-dom";
import { Wordmark, TruckIcon, ChevronRight } from "./ui";

/**
 * The chrome around checkout, and deliberately almost none of it.
 *
 * ── WHY CHECKOUT LOSES THE NAVIGATION ──────────────────────────────────────────────
 *
 * Checkout was rendering the full storefront shell: the six-group header, the complete footer
 * with fifteen links across Shop / Help / Company, and the fixed bottom navigation bar. On a
 * 390px screen that is roughly two and a half screenfuls of ways to leave, wrapped around one
 * button that finishes the sale — and the bottom bar sits permanently over the part of the
 * viewport where the Place Order button lands.
 *
 * Every one of those links is a door out of a room the customer had already decided to be in.
 * Stripping them is the single most standard move in commerce design and the store was not
 * doing it.
 *
 * ── WHAT REPLACES IT ───────────────────────────────────────────────────────────────
 *
 * Not nothing. Removing the furniture from a page where someone is about to hand over their
 * address and agree to pay cash at their door would read as abandonment, so what remains is
 * the minimum that answers "where am I, can I go back, and is this real":
 *
 *   · the wordmark, unlinked — it identifies without inviting a click away
 *   · one way back to the bag, which is the only exit a customer at checkout actually wants
 *   · the payment reality, stated plainly, because "cash on delivery" IS the trust story here.
 *     There is no card form to secure and no padlock to earn; claiming otherwise would be the
 *     kind of unbacked promise this codebase has spent a lot of effort removing.
 *   · the two policy links that are genuinely part of an informed purchase
 */
export function CheckoutShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="border-b border-line bg-surface">
        <div className="wrap flex items-center justify-between py-3.5">
          <Link
            to="/cart"
            className="inline-flex items-center gap-1 text-[13px] font-semibold text-muted transition-colors hover:text-plum"
          >
            <ChevronRight className="h-4 w-4 rotate-180" />
            Bag
          </Link>

          {/*
            Not a link. The one page where the lockup's job is to reassure, not to navigate.

            It uses the real `Wordmark` rather than the hand-built stand-in it used to carry —
            two different-looking logos across a two-page checkout flow is exactly the sort of
            small wrongness that reads as "is this the same site" at the moment someone is
            about to hand over an address.
          */}
          <Wordmark className="h-6" />

          {/* Balances the row so the wordmark sits truly centred. */}
          <span className="w-12" aria-hidden="true" />
        </div>
      </header>

      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        {children}
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="wrap py-6">
          <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-muted">
            <TruckIcon className="mt-0.5 h-4 w-4 shrink-0 text-plum" />
            <span>
              No card details are taken on this site — you pay the courier in cash when your
              order arrives. We confirm every item with you on WhatsApp before it is dispatched.
            </span>
          </p>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-muted">
            <Link to="/info/returns" className="hover:text-plum">Returns &amp; refunds</Link>
            <Link to="/info/privacy" className="hover:text-plum">Privacy</Link>
            <Link to="/info/terms" className="hover:text-plum">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
