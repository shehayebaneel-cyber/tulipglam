import { Suspense } from "react";
import { Outlet, ScrollRestoration, useLocation } from "react-router-dom";
import { Header } from "./Header";
import { Spinner } from "./ui";
import { Footer } from "./Footer";
import { BottomNav } from "./BottomNav";
import { CheckoutShell } from "./CheckoutShell";

/**
 * Routes that get the stripped shell instead of the storefront one.
 *
 * Only checkout. The cart deliberately keeps full navigation — someone with a bag open is
 * still shopping and "add one more thing" is a good outcome there. Once they have committed to
 * paying, every link is a way to lose the sale. See CheckoutShell for the reasoning.
 */
const FOCUSED = new Set(["/checkout"]);

/**
 * One boundary for every storefront route.
 *
 * Five routes off the critical path are lazily loaded (Track, Account, Rewards, Info,
 * password reset), and a lazy component without a Suspense above it throws rather than waits.
 * Putting the boundary here — where every storefront route already passes through — means the
 * next route that becomes lazy needs no second thought, instead of a crash that only shows up
 * when someone taps that one link.
 *
 * min-h so the footer does not jump up the page for the fraction of a second a chunk takes.
 */
const RouteChunk = () => (
  <Suspense fallback={<div className="grid min-h-[60vh] place-items-center text-plum"><Spinner /></div>}>
    <Outlet />
  </Suspense>
);


export function Layout() {
  const { pathname } = useLocation();

  if (FOCUSED.has(pathname)) {
    return (
      <>
        <a href="#main" className="skip-link">Skip to content</a>
        <CheckoutShell><RouteChunk /></CheckoutShell>
        <ScrollRestoration />
      </>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/*
        Skip link. The header holds the menu button, the wordmark, search, account, wishlist,
        bag and six nav groups with dropdowns — so reaching the products by keyboard meant
        tabbing through all of it on every single page. Visually hidden until focused.
      */}
      <a href="#main" className="skip-link">Skip to content</a>
      <Header />
      {/* tabIndex -1 so the skip link can move focus here, not just scroll to it — without it
          the next Tab would continue from the header where focus actually still was. */}
      <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
        <RouteChunk />
      </main>
      <Footer />
      <BottomNav />
      <ScrollRestoration />
    </div>
  );
}
