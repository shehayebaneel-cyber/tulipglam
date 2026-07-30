import { ButtonLink } from "../components/Button";
import { useStore } from "../lib/store";
import { ProductCard } from "../components/ProductCard";
import { HeartIcon } from "../components/ui";

export function Wishlist() {
  const { wishlist } = useStore();

  if (wishlist.length === 0) return (
    <div className="wrap grid min-h-[56vh] place-items-center py-16 text-center">
      <div>
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-plum-soft text-plum"><HeartIcon className="h-7 w-7" /></div>
        <h1 className="serif mt-5 text-3xl text-ink">Your wishlist is empty</h1>
        <p className="mx-auto mt-2 max-w-xs text-sm text-muted">Tap the heart on anything you love to save it here for later.</p>
        <ButtonLink to="/shop" variant="primary" size="lg" className="mt-6">Explore products</ButtonLink>
      </div>
    </div>
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
