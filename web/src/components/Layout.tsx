import { Outlet, ScrollRestoration } from "react-router-dom";
import { Header } from "./Header";
import { Footer } from "./Footer";
import { BottomNav } from "./BottomNav";

export function Layout() {
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
        <Outlet />
      </main>
      <Footer />
      <BottomNav />
      <ScrollRestoration />
    </div>
  );
}
