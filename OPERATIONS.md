# Running TulipGlam

Written for a phone. Every heading is a thing you actually do; every step names the screen or the
command. Where something is manual, it says so — a manual step you know about is fine, one you
discover on a bad morning is not.

Rehearsed end to end on 5 Aug 2026 (`server/scripts/rehearsal.mjs`): twelve orders placed and
worked through their whole lives. What that rehearsal found is in `.night/friction.md`.

---

## The daily loop

### 1. New orders — first thing

**Admin → Orders.** Anything in **Order Received** is waiting on you.

Open one. You are looking for: can I source every line, at the price shown?

- **Yes** → move it to **Confirming Availability**, then **Confirmed** once you have checked.
- **One line I cannot get** → this is the common case, and it has its own flow. Set the order to
  **Awaiting Your Confirmation** and use the awaiting-item controls: name the line, say what you
  asked, and the order records how long it has been waiting. Removing that line **recomputes the
  money on the server** — subtotal, delivery, coupon and gift card — because dropping a line can
  push the order back under the free-delivery threshold or below a coupon minimum. Never
  recalculate a total by hand.
- **Nothing I can get** → **Unavailable**. Terminal, and it does not count as a sale.

### 2. Confirm on WhatsApp

Every order is confirmed by message before you spend money sourcing it. The order screen has the
WhatsApp button with the customer's number; it is **disabled with a reason** if the store number
is missing or a placeholder, rather than opening a dead link.

> Template wording is drafted and awaiting your sign-off — see DECISIONS.md. Until you approve
> them the buttons are marked **DRAFT**.

### 3. Source and pack

**Confirmed → Sourcing → Packed.** These are yours to move as the goods arrive.

### 4. The dispatch run

**Admin → Dispatch.** This is the screen built for a phone in a van: one card per delivery, the
**amount to collect** set large, the customer's number as a tap-to-call link.

Move orders **Packed → Dispatched → Out for Delivery** as you load and set off.

### 5. At the door

- **Paid and handed over** → **Delivered**. This is the moment that matters: it stamps
  `deliveredAt`, and points start their seven-day hold from it.
- **Customer refuses the parcel** → **Refused at Door**, *not* Cancelled. They are different on
  purpose: refused means you drove there and they declined, and it is the only way to see how
  often that happens. It is reachable **only** from Out for Delivery.
- **Something else went wrong** → **On Hold**, and deal with it.

### 6. Reconcile

**Admin → Dispatch → reconcile.** What you collected against what was owed. Do it the same day —
this is the only record that the cash matches the orders.

---

## The weekly glance

Five minutes, once a week. In this order:

| | Where | What you are looking for |
|---|---|---|
| **Pulse** | Admin → Pulse | Errors, and their age. New errors since last week are the signal. |
| **Backups** | run the drill (below) | Backup age. If nothing has been taken this week, take one now. |
| **Setup** | Admin → Dashboard | The **Setup incomplete** banner. It lists anything unconfigured, worst first: a *placeholder* value that looks real is the dangerous kind. |
| **Signups** | Admin → Customers | Are accounts being created, and do they look like people? |
| **Points liability** | Admin → Rewards | What you owe in unredeemed points. It only goes up until someone spends. |
| **Requests** | Admin → Requests | Products customers asked for and you do not list. This is free demand research. |

### The backup, weekly and before anything risky

```
cd server
node --env-file=.env --import tsx scripts/pg-restore-drill.mjs
```

Dumps production **read-only**, restores it locally, and **starts the store on the restored copy**
to prove it actually works. Takes about 70 seconds. Full detail in BACKUP.md.

**Nothing is scheduled.** This is a habit, not a cron. Run it before every import, before every
schema change, and once a week regardless.

---

## Incidents

### The site is down

1. **Is it the site or your connection?** Open it on mobile data with wifi off.
2. **Check the host.** Whatever is serving it — dashboard, then logs.
3. **Check the database.** If the app is up and every page errors, it is almost always the
   database being unreachable, not the code.
4. **Do not deploy anything to fix it** until you know what broke. A deploy during an outage
   changes two variables at once.
5. **The gate still holds.** If the store is pre-launch and something has gone wrong, confirm a
   stranger still sees only the placeholder — that outranks fixing the outage.

### A wrong price was sold

The order stores a **snapshot** of what was charged, so the order itself is a faithful record even
after you fix the catalogue.

1. **Fix the product first**, so nobody else buys at the wrong price.
2. **Decide on the order in front of you.** Honour it, or contact the customer before dispatch.
   That is a business call, not a technical one.
3. **If you honour it**, change nothing on the order — it is correct as a record of what was
   agreed.
4. **If the customer agrees to the corrected price**, use the awaiting-item flow so the money is
   recomputed on the server rather than edited by hand.

### A dispute at the door

1. **Do not argue about money at the door.** Take the parcel back and mark the order
   **Refused at Door**.
2. **Then work out what happened** from the order screen: it shows the full breakdown — area fee,
   whether the free-delivery threshold applied, coupon and gift-card codes — which is what you
   need to explain a total.
3. If the customer was right, that is a catalogue or pricing fix, not an order edit.

### A refused parcel

Mark it **Refused at Door**. That is all — it is terminal.

It matters that you use *Refused* rather than *Cancelled*: refusals are counted, and the loyalty
programme uses them for its three-strikes flag. A refusal that looks like a cancellation loses
that information permanently.

A re-attempt is a **new order**, not a resurrection of the old one.

### A refund

There is no card gateway, so a refund is cash you hand back or a gift card you issue.

1. **Cash back** → record it however you record money. The order stays as it is: it is a true
   record of what happened.
2. **Gift card instead** → Admin → Gift Cards → issue one for the amount.
3. **Points already earned on that order** — if the order was delivered and then refunded, the
   points confirmed or will confirm. Adjust the balance in Admin → Rewards with a reason. The
   ledger keeps the reason, which is what makes it explainable later.

### Someone says their points are wrong

Admin → Rewards → find the account by phone. The ledger shows every entry with its reason: what
earned, what matured, what was spent.

The three rules that answer most questions:

- **The rate you saw when you ordered is the rate you get.** The multiplier is stamped at
  placement and honoured at maturity.
- **A new tier applies from the next order.** An order can never buy the tier that pays it.
- **Points confirm seven days after delivery**, measured from `deliveredAt`.

---

## Things that are manual, and honestly so

| | |
|---|---|
| **Backups** | No schedule. You run the command. |
| **WhatsApp messages** | Typed or pasted by you. There is no automation. |
| **Order status** | Every move is yours. Nothing advances on a timer. |
| **Sourcing** | Obviously. This shop holds no stock. |
| **Reconciliation** | You count the cash. |
| **Our Picks** | You choose the 8. It becomes automatic only when there are enough delivered orders to mean "best seller" — see DECISIONS.md. |

## Things that are automatic, so you do not need to worry about them

| | |
|---|---|
| **Money at checkout** | Always recomputed server-side. A customer cannot send you a price. |
| **Points maturity** | Time-based from `deliveredAt`. Correct whether or not any job runs. |
| **The brand allowlist** | Re-applied after every import; products from brands you do not sell re-hide themselves. |
| **Search text** | Rebuilt after every import. |
| **Status transitions** | Illegal moves are rejected by the server, not just hidden in the UI. |

---

## The one-line version

**Daily:** new orders → confirm on WhatsApp → source → dispatch run → delivered → reconcile.

**Weekly:** pulse, backup drill, setup banner, points liability.

**When it goes wrong:** stop, find out what happened, and only then change one thing.
