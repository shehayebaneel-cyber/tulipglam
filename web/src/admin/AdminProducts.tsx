import { useEffect, useState } from "react";
import { adminApi, type AdminProductFull, type AdminCategory, type AdminBrand } from "./adminApi";
import { ProductList } from "./ProductList";
import { ProductEditor } from "./ProductEditor";
import { Spinner } from "../components/ui";
import { useToast } from "./primitives/Toast";

/**
 * Products screen: the list, or the editor for one product. The list owns all of its state
 * in the URL, so returning from the editor lands back on the same page, filters and sort.
 */
export function AdminProducts() {
  const [editing, setEditing] = useState<AdminProductFull | "new" | null>(null);
  const [opening, setOpening] = useState(false);
  const [cats, setCats] = useState<AdminCategory[]>([]);
  const [brands, setBrands] = useState<AdminBrand[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const { push } = useToast();

  useEffect(() => {
    adminApi.categories().then((r) => setCats(r.categories)).catch(() => setCats([]));
    adminApi.brands().then((r) => setBrands(r.brands)).catch(() => setBrands([]));
  }, []);

  const openEdit = async (id: number) => {
    setOpening(true);
    try {
      setEditing(await adminApi.product(id));
    } catch (e) {
      push("error", `Could not open that product: ${(e as Error).message}`);
    } finally {
      setOpening(false);
    }
  };

  if (opening) return <div className="grid place-items-center py-24 text-plum"><Spinner /></div>;

  if (editing) {
    return (
      <ProductEditor
        product={editing}
        cats={cats}
        brands={brands}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); setReloadKey((n) => n + 1); }}
      />
    );
  }

  return <ProductList key={reloadKey} onEdit={openEdit} onNew={() => setEditing("new")} />;
}
