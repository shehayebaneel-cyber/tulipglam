import { NavLink } from "react-router-dom";
import { HomeIcon, GridIcon, HeartIcon, BagIcon, UserIcon } from "./ui";
import { useStore } from "../lib/store";

// Thumb-reachable primary nav — mobile only.
export function BottomNav() {
  const { cartCount, wishlist } = useStore();
  const items = [
    { to: "/", label: "Home", Icon: HomeIcon, end: true, badge: 0 },
    { to: "/shop", label: "Shop", Icon: GridIcon, badge: 0 },
    { to: "/wishlist", label: "Wishlist", Icon: HeartIcon, badge: wishlist.length },
    { to: "/cart", label: "Bag", Icon: BagIcon, badge: cartCount },
    { to: "/account", label: "Account", Icon: UserIcon, badge: 0 },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <div className="mx-auto flex max-w-md items-stretch justify-around">
        {items.map(({ to, label, Icon, end, badge }) => (
          <NavLink key={to} to={to} end={end}
            className={({ isActive }) => `relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium ${isActive ? "text-plum" : "text-muted"}`}>
            <span className="relative">
              <Icon className="h-[22px] w-[22px]" />
              {badge > 0 && <span className="absolute -right-2 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-plum px-1 text-[9px] font-bold text-white">{badge}</span>}
            </span>
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
