# Turning on points

Follow this on your phone. Every step says what you should see. If a step doesn't match,
**stop and skip to "If something's wrong"** at the bottom — it's one switch and there's
nothing to undo.

About 20 minutes. Nobody can see any of it: the store is still behind the gate.

---

## Before you start

You need three things open or to hand:

- **Render** → your TulipGlam service → **Environment**
- **Your admin key** (the one you type at `/admin`)
- **Your preview link** — your store address with `?preview=YOUR_KEY` on the end.
  Open it once and you stay in preview; the phone remembers.

You'll also make a **test customer account** in step 3. Use a real email you can open,
and a phone number that is *not* yours — you're going to give this account points, and
you don't want that mixed into your own history.

---

## 1 · Flip the switch

In Render → Environment, set:

```
LOYALTY_REDEMPTION_ENABLED = true
```

Check that **`LOYALTY_ENABLED` is already `true`** while you're there. If it isn't, set
that too — redemption on its own does nothing.

Save. Render redeploys on its own. Give it about two minutes.

> ✅ **You should see:** the service goes back to *Live* in Render.

---

## 2 · Check the store is still dark

Open your store address **in a private/incognito tab** — no preview key.

> ✅ **You should see:** the coming-soon page. Same as always.
>
> 🛑 **If you see the real shop:** stop. The gate is the only thing keeping this private.

Now open your **preview link** in your normal tab.

> ✅ **You should see:** the real shop.

---

## 3 · Make a test account and give it points

1. On the shop, **register** a new account (the email you can open, the phone that isn't yours).
2. Visit **`/rewards`** while signed in. This is what creates the loyalty account.

> ✅ **You should see:** a rewards page with a balance of **0 points**, headed
> **"Available to spend"**.
>
> 🛑 **If that heading says "Points earned" instead:** the flag hasn't taken effect yet.
> That wording is the tell — while redemption is off the page deliberately never promises
> the points can be exchanged for anything. Wait a minute, reload, and check again.

Now, in another tab, go to **`/admin/loyalty`**:

3. Search for the phone number you registered with.
4. Open the account → **Adjust**.
5. Give it **500 points**. Reason: `testing redemption before launch`. Put your own name in.

Go back to `/rewards` on the shop and pull to refresh.

> ✅ **You should see:** **500 points**.

*(Why the manual credit: points earned from a real order don't mature for 7 days after
delivery. That hold is deliberate — it's what protects you when a COD order comes back —
but it does mean you can't wait for it standing in the kitchen.)*

---

## 4 · Place an order, spending points

Still signed in as the test customer, on the preview link:

1. Add something to the basket — aim for a total **over $20** so there's room to discount.
2. Go to checkout. Fill in the address as normal.
3. Look for the **points panel**.

> ✅ **You should see:** an option to spend your points, showing how many you have.
>
> 🛑 **If there's no points panel at all:** the flag hasn't taken effect. Wait another
> minute and reload. If it's still missing after five, go to "If something's wrong".

4. **Spend the maximum it offers.**

> ✅ **You should see** the total drop, and a line in the summary naming the points
> discount — not a mystery deduction. Subtotal − discount + delivery should equal the total.
>
> **Write the final total down.** Call it **the number**.

5. Place the order. Note the order number.

---

## 5 · The same number at the door

This is the whole reason redemption was held back. Three places, one figure.

**a. The tracking page.** Open the order-tracking link (or `/track` with the order number).

> ✅ **You should see** the same breakdown, including the points line, adding up to **the number**.

**b. The run.** On your phone, go to **`/admin/dispatch`**.

The order won't be there yet — it's still *Received*. Go to `/admin/orders`, open it, and
move it along to **Packed** (Confirmed → Packed). Then reload Dispatch.

> ✅ **You should see** a card with the customer's name, and **the number** in large type
> with COLLECT under it.
>
> ✅ **Under it, a plum-coloured line** saying `$X.XX paid with points · $Y.YY delivery`.
> That line is what stops you collecting the wrong amount at a door.
>
> ✅ **The other orders on the run have no such line.** That's correct — nothing reduced them.

**c. The message.** Tap the WhatsApp button on the card to copy the courier message.
Paste it into any notes app.

> ✅ **You should see** `COLLECT: <the number> cash` on the second line, with the reason
> in brackets under it. No item prices. No coupon codes.
>
> 🛑 **If any of the three shows a different figure:** stop. That's the exact failure this
> was built to prevent, and it needs fixing before a real order goes out.

---

## 6 · Count up

Still on `/admin/dispatch`, scroll to **Count up today** and tap it.

> ✅ **You should see** *Still out* including this order, with **the number** in it,
> and *Collected* at $0.00. Nothing has been delivered yet, so that's right.

---

## 7 · Watch the points come back — twice

Two different ways an order dies. Both must return the points.

**a. Refused at the door.**

1. Make a **second** order the same way, also spending points. Note what it discounts.
2. In `/admin/orders`, walk it along: **Confirmed → Packed → Dispatched → Out for Delivery**,
   then **Refused at Door**. (The screen only offers you legal next steps, so you can't get
   it wrong — just keep tapping the one that moves it forward.)
3. Go to `/rewards` on the shop (signed in as the test customer). Refresh.

> ✅ **You should see** the points from that order **back in the balance**.

**b. Cancelled.**

4. Take the **first** order (the one from step 4) to **Cancelled**.
5. Refresh `/rewards` again.

> ✅ **You should see** those points back too — the balance should be at or near the
> 500 you started with.
>
> 🛑 **If either lot doesn't come back:** stop, and turn the flag off. A customer whose
> order was refused and whose points vanished will not come back either.

**c. Count up again.** Back on `/admin/dispatch` → **Count up**.

> ✅ **You should see** the refused order listed under *Refused or cancelled*, with the
> amount that **didn't** arrive, and *Collected* still $0.00. A refusal is not a shortfall.

---

## 8 · Clean up

In `/admin/loyalty`, find the test account and **Adjust it back to zero** — take off
whatever's left, reason `end of redemption test`. The account and its two dead orders can
stay; they're honest history and they cost nothing.

---

## If something's wrong

In Render → Environment:

```
LOYALTY_REDEMPTION_ENABLED = false
```

Save. Two minutes. That's it.

The points panel disappears from checkout entirely — it isn't greyed out, it isn't
"unavailable", it's simply not there, so nothing is advertised that can't be used. Any
points already spent stay spent and any order already placed keeps its discount; nothing
is rewritten behind a customer's back.

Then tell me what you saw and I'll fix it.

---

## What this doesn't cover

Two things I couldn't test for you, and you should know they're open:

- **A real 7-day earn.** Everything above uses a manual credit. The actual path — order,
  deliver, wait a week, points appear — has been tested against the database but never
  end-to-end on the live site, because it takes a week.
- **Two people checking out at once with the same points.** Tested locally, and there's now
  a retry that falls back to placing the order at full price rather than losing it. Real
  traffic is the only real proof, and at your current volume you'll be fine.
