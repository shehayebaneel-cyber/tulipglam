import { useStore } from "../lib/store";
import { ProductCard } from "../components/ProductCard";
import { EmptyState } from "../components/EmptyState";

export function Wishlist() {
  const { wishlist } = useStore();

  if (wishlist.length === 0) return (
    <EmptyState
      title="Your wishlist is empty"
      body="Tap the heart on anything you want to come back to. It stays on this device."
      action={{ label: "Browse the shop", to: "/shop" }}
    />
  );

  return (
    <div className="wrap py-6 sm:py-8">
      <h1 className="serif text-3xl font-medium text-ink sm:text-4xl">Wishlist</h1>
      <p className="mt-1 text-sm text-muted">{wishlist.length} saved item{wishlist.length === 1 ? "" : "s"}</p>
      <div className="mt-6 grid grid-cols-2 gap-x-3.5 gap-y-8 sm:grid-cols-3 sm:gap-5 xl:grid-cols-4">
        {wishlist.map((p) => <ProductCard key={p.id} p={p} />)}
      </div>
    </div>
  );
}
