// The 13 order statuses, in lifecycle order. Shared shape used by API + admin.
// `terminal` statuses end the flow; `customer` marks ones the shopper sees as active.
export const ORDER_STATUSES = [
  { key: "received", label: "Order Received", hint: "We've got your order and will confirm availability.", tone: "info" },
  { key: "confirming", label: "Confirming Availability", hint: "Checking each item is available to source.", tone: "info" },
  { key: "awaiting_customer", label: "Awaiting Your Confirmation", hint: "We've contacted you about an item — reply to proceed.", tone: "warn" },
  { key: "confirmed", label: "Confirmed", hint: "All items available. Your order is confirmed.", tone: "good" },
  { key: "sourcing", label: "Sourcing", hint: "We're getting your items ready.", tone: "info" },
  { key: "packed", label: "Packed", hint: "Your order is packed and ready to dispatch.", tone: "info" },
  { key: "dispatched", label: "Dispatched", hint: "Handed to the courier.", tone: "info" },
  { key: "out_for_delivery", label: "Out for Delivery", hint: "Arriving today — have cash ready.", tone: "info" },
  { key: "delivered", label: "Delivered", hint: "Delivered. Enjoy!", tone: "good" },
  { key: "completed", label: "Completed", hint: "Order complete. Thank you!", tone: "good" },
  { key: "on_hold", label: "On Hold", hint: "Temporarily paused — we'll be in touch.", tone: "warn" },
  { key: "cancelled", label: "Cancelled", hint: "This order was cancelled.", tone: "bad", terminal: true },
  { key: "unavailable", label: "Unavailable", hint: "Items could not be sourced. We've contacted you.", tone: "bad", terminal: true },
] as const;

export const STATUS_KEYS = ORDER_STATUSES.map((s) => s.key);
export const statusMeta = (key: string) => ORDER_STATUSES.find((s) => s.key === key) ?? ORDER_STATUSES[0];

// ---------------------------------------------------------------- transitions
// Legal moves between statuses, enforced server-side. Before this existed the admin sent
// whatever its <select> held and the API wrote it, so an order could jump from `received`
// straight to `delivered`, or leave a terminal state. The client offers only these; the
// server independently rejects anything else.
const TRANSITIONS: Record<string, readonly string[]> = {
  received: ["confirming", "awaiting_customer", "confirmed", "on_hold", "cancelled", "unavailable"],
  confirming: ["awaiting_customer", "confirmed", "on_hold", "cancelled", "unavailable"],
  awaiting_customer: ["confirmed", "sourcing", "on_hold", "cancelled", "unavailable"],
  confirmed: ["sourcing", "packed", "on_hold", "cancelled", "unavailable"],
  sourcing: ["packed", "awaiting_customer", "on_hold", "cancelled", "unavailable"],
  packed: ["dispatched", "on_hold", "cancelled"],
  dispatched: ["out_for_delivery", "on_hold", "cancelled"],
  out_for_delivery: ["delivered", "on_hold", "cancelled"],
  delivered: ["completed"],
  completed: [],
  on_hold: ["confirming", "awaiting_customer", "confirmed", "sourcing", "cancelled", "unavailable"],
  cancelled: [],
  unavailable: [],
};

/** Statuses an order may legally move to from `from`. Empty for terminal states. */
export const nextStatuses = (from: string): readonly string[] => TRANSITIONS[from] ?? [];

/** Same-status is allowed (a no-op re-save); anything not in the table is rejected. */
export const canTransition = (from: string, to: string): boolean =>
  from === to || nextStatuses(from).includes(to);

export const isTerminal = (key: string): boolean => nextStatuses(key).length === 0;
