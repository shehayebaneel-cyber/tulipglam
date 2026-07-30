import { Suspense, lazy } from "react";
import { createBrowserRouter, RouterProvider, Link, useLocation } from "react-router-dom";
import { StoreProvider } from "./lib/store";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { Shop } from "./pages/Shop";
import { Product } from "./pages/Product";
import { Cart } from "./pages/Cart";
import { Checkout } from "./pages/Checkout";
import { OrderSuccess } from "./pages/OrderSuccess";
import { Track } from "./pages/Track";
import { Wishlist } from "./pages/Wishlist";
import { Brands } from "./pages/Brands";
import { GiftCards } from "./pages/GiftCards";
import { Contact } from "./pages/Contact";
import { Account } from "./pages/Account";
import { Login } from "./pages/Login";
import { ForgotPassword, ResetPassword } from "./pages/Password";
import { Info } from "./pages/Info";
import { TulipMark, Spinner } from "./components/ui";
import { ErrorBoundary } from "./components/ErrorState";

/**
 * Admin is loaded on demand.
 *
 * Twelve admin screens — the product table, the order workflow, the Excel importer and the
 * xlsx library behind it — were in the same bundle as the storefront, so every shopper on a
 * phone downloaded and parsed the whole back office before seeing a product. One operator uses
 * it; thousands of visitors paid for it.
 *
 * Storefront pages stay eagerly imported on purpose: they are what a first visit renders, and
 * splitting them would trade bundle size for a spinner on the critical path.
 */
const AdminLayout = lazy(() => import("./admin/AdminLayout").then((m) => ({ default: m.AdminLayout })));
const Dashboard = lazy(() => import("./admin/Dashboard").then((m) => ({ default: m.Dashboard })));
const AdminProducts = lazy(() => import("./admin/AdminProducts").then((m) => ({ default: m.AdminProducts })));
const AdminCategories = lazy(() => import("./admin/AdminCategories").then((m) => ({ default: m.AdminCategories })));
const AdminBrands = lazy(() => import("./admin/AdminBrands").then((m) => ({ default: m.AdminBrands })));
const AdminOrders = lazy(() => import("./admin/AdminOrders").then((m) => ({ default: m.AdminOrders })));
const AdminReviews = lazy(() => import("./admin/AdminReviews").then((m) => ({ default: m.AdminReviews })));
const AdminSettings = lazy(() => import("./admin/AdminSettings").then((m) => ({ default: m.AdminSettings })));
const AdminImport = lazy(() => import("./admin/AdminImport").then((m) => ({ default: m.AdminImport })));
const AdminCoupons = lazy(() => import("./admin/AdminCoupons").then((m) => ({ default: m.AdminCoupons })));
const AdminGiftCards = lazy(() => import("./admin/AdminGiftCards").then((m) => ({ default: m.AdminGiftCards })));
const AdminCustomers = lazy(() => import("./admin/AdminCustomers").then((m) => ({ default: m.AdminCustomers })));

/** Shown while an admin chunk downloads. Full height so the layout doesn't jump when it lands. */
const AdminChunk = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={<div className="grid min-h-[60vh] place-items-center text-plum"><Spinner /></div>}>
    {children}
  </Suspense>
);

/**
 * 404.
 *
 * The old page offered one link, home, which is the least useful destination for someone who
 * arrived with something specific in mind. A dead product link is the common case — a stale
 * bookmark, or a URL from before an import renamed a slug — so this offers a search seeded
 * from the path they tried, plus the places worth trying next.
 */
function NotFound() {
  const { pathname } = useLocation();
  // "/product/dali-nail-polish-42" → "dali nail polish 42". The trailing id is dropped, since
  // searching for it finds nothing.
  const guess = decodeURIComponent(pathname)
    .split("/").filter(Boolean).slice(-1)[0]?.replace(/[-_]+/g, " ").replace(/\s*\b\d{2,}\b\s*$/, "").trim() ?? "";

  return (
    <div className="wrap grid min-h-[56vh] place-items-center py-20 text-center">
      <div className="max-w-md">
        <TulipMark className="mx-auto h-10 w-10 text-plum/70" />
        <h1 className="serif mt-4 text-3xl font-medium text-ink">Page not found</h1>
        <p className="mx-auto mt-2 text-sm text-muted">
          The page you’re looking for doesn’t exist or has moved. Products are sometimes relisted
          under a new link.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {guess && <Link to={`/search?q=${encodeURIComponent(guess)}`} className="btn btn-ink px-5 py-2.5">Search for “{guess}”</Link>}
          <Link to="/shop" className="btn btn-ghost px-5 py-2.5">Browse everything</Link>
        </div>
        <p className="mt-6 text-[13px] text-muted">
          Looking for an order? <Link to="/track" className="font-semibold text-plum hover:underline">Track it by number</Link> — no sign-in needed.
        </p>
      </div>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/shop", element: <Shop mode="all" /> },
      { path: "/category/:slug", element: <Shop mode="category" /> },
      { path: "/new", element: <Shop mode="new" /> },
      { path: "/bestsellers", element: <Shop mode="bestsellers" /> },
      { path: "/sale", element: <Shop mode="sale" /> },
      { path: "/search", element: <Shop mode="search" /> },
      { path: "/product/:slug", element: <Product /> },
      { path: "/cart", element: <Cart /> },
      { path: "/checkout", element: <Checkout /> },
      { path: "/order/:number", element: <OrderSuccess /> },
      { path: "/track", element: <Track /> },
      { path: "/track/:number", element: <Track /> },
      { path: "/wishlist", element: <Wishlist /> },
      { path: "/brands", element: <Brands /> },
      { path: "/gift-cards", element: <GiftCards /> },
      { path: "/contact", element: <Contact /> },
      { path: "/account", element: <Account /> },
      { path: "/login", element: <Login mode="login" /> },
      { path: "/register", element: <Login mode="register" /> },
      { path: "/forgot-password", element: <ForgotPassword /> },
      { path: "/reset-password", element: <ResetPassword /> },
      { path: "/orders", element: <Track /> },
      { path: "/shipping", element: <Info slug="shipping" /> },
      { path: "/returns", element: <Info slug="returns" /> },
      { path: "/faq", element: <Info slug="faq" /> },
      { path: "/about", element: <Info slug="about" /> },
      { path: "/privacy", element: <Info slug="privacy" /> },
      { path: "/terms", element: <Info slug="terms" /> },
      { path: "/gift-card-terms", element: <Info slug="gift-card-terms" /> },
      { path: "*", element: <NotFound /> },
    ],
  },
  {
    path: "/admin",
    element: <AdminChunk><AdminLayout /></AdminChunk>,
    children: [
      { index: true, element: <AdminChunk><Dashboard /></AdminChunk> },
      { path: "orders", element: <AdminChunk><AdminOrders /></AdminChunk> },
      { path: "products", element: <AdminChunk><AdminProducts /></AdminChunk> },
      { path: "categories", element: <AdminChunk><AdminCategories /></AdminChunk> },
      { path: "brands", element: <AdminChunk><AdminBrands /></AdminChunk> },
      { path: "coupons", element: <AdminChunk><AdminCoupons /></AdminChunk> },
      { path: "gift-cards", element: <AdminChunk><AdminGiftCards /></AdminChunk> },
      { path: "customers", element: <AdminChunk><AdminCustomers /></AdminChunk> },
      { path: "reviews", element: <AdminChunk><AdminReviews /></AdminChunk> },
      { path: "settings", element: <AdminChunk><AdminSettings /></AdminChunk> },
      { path: "import", element: <AdminChunk><AdminImport /></AdminChunk> },
    ],
  },
]);

export default function App() {
  return (
    // One boundary around everything: a crash anywhere below it shows a page that explains
    // itself and offers a reload, instead of React unmounting the tree to a blank screen.
    <ErrorBoundary>
      <StoreProvider>
        <RouterProvider router={router} />
      </StoreProvider>
    </ErrorBoundary>
  );
}
