import { createBrowserRouter, RouterProvider, Link } from "react-router-dom";
import { StoreProvider } from "./lib/store";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { Shop } from "./pages/Shop";
import { Audience } from "./pages/Audience";
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
import { TulipMark } from "./components/ui";

import { AdminLayout } from "./admin/AdminLayout";
import { Dashboard } from "./admin/Dashboard";
import { AdminProducts } from "./admin/AdminProducts";
import { AdminCategories } from "./admin/AdminCategories";
import { AdminBrands } from "./admin/AdminBrands";
import { AdminOrders } from "./admin/AdminOrders";
import { AdminReviews } from "./admin/AdminReviews";
import { AdminSettings } from "./admin/AdminSettings";
import { AdminImport } from "./admin/AdminImport";
import { AdminCoupons } from "./admin/AdminCoupons";
import { AdminGiftCards } from "./admin/AdminGiftCards";
import { AdminCustomers } from "./admin/AdminCustomers";

function NotFound() {
  return (
    <div className="wrap grid min-h-[56vh] place-items-center py-20 text-center">
      <div>
        <TulipMark className="mx-auto h-10 w-10 text-plum/70" />
        <h1 className="serif mt-4 text-3xl font-medium text-ink">Page not found</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">The page you’re looking for doesn’t exist or has moved.</p>
        <Link to="/" className="btn btn-ink mt-6 px-6 py-3">Back to home</Link>
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
      // Who a product is for cuts across every department, so these are their own routes
      // rather than categories. One component serves all four paths.
      { path: "/men", element: <Audience audience="men" /> },
      { path: "/men/:department", element: <Audience audience="men" /> },
      { path: "/women", element: <Audience audience="women" /> },
      { path: "/women/:department", element: <Audience audience="women" /> },
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
    element: <AdminLayout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "orders", element: <AdminOrders /> },
      { path: "products", element: <AdminProducts /> },
      { path: "categories", element: <AdminCategories /> },
      { path: "brands", element: <AdminBrands /> },
      { path: "coupons", element: <AdminCoupons /> },
      { path: "gift-cards", element: <AdminGiftCards /> },
      { path: "customers", element: <AdminCustomers /> },
      { path: "reviews", element: <AdminReviews /> },
      { path: "settings", element: <AdminSettings /> },
      { path: "import", element: <AdminImport /> },
    ],
  },
]);

export default function App() {
  return (
    <StoreProvider>
      <RouterProvider router={router} />
    </StoreProvider>
  );
}
