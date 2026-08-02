# Policy drafts — for your signature, not for shipping

**Nothing in this file is live.** These are drafts. Every one of them promises a customer
something, and that is yours to sign rather than mine to discover.

Each section has **the decision you need to make** at the top, then wording that follows from
it. Where I could not write a sentence without inventing a fact, I have left a `[BLANK]` and
said what it needs.

Once you have decided, these go into Settings (the policy pages are already settings-driven, so
they need no deploy) — except where marked otherwise.

---

## 1. Returns and refunds

### The decision

**How many days does a customer have to return something, and what condition must it be in?**

This one is urgent for a reason that is not obvious: **the loyalty programme already assumes
seven days.** Points confirm seven days after delivery, and the whole reason for that hold is
that a cash-on-delivery order can come back. If your real returns window is fourteen days, a
customer can return an order on day ten having already spent the points it earned.

I did not change the hold to match a policy that does not exist yet. Pick the window and I
will align `RATES.holdDaysAfterDelivery` to it.

- **7 days** — matches the code today. Nothing to change.
- **14 days** — more generous, standard for beauty retail. I change the hold to 14, which means
  customers wait two weeks for points.
- **Something else** — tell me and I will align it.

There is a real tension here: a longer returns window is better for customers and worse for
the points programme, because it makes everyone wait longer to spend. Seven is the safer
launch number and can be extended later; shortening it after launch is the move that upsets
people.

### The second decision

**Are opened cosmetics returnable?** Most beauty retailers say no, for hygiene, with an
exception for a faulty or wrong item. If you want that exception, it needs to be written down
or your team will improvise it differently every time.

### Draft wording

> **Returns**
>
> If something isn't right, tell us within **[7 / 14]** days of delivery and we'll put it
> right.
>
> Because we sell cosmetics and personal care, we can only accept items back **unopened and
> unused, with their seal intact**. That is a hygiene rule, not a technicality — we cannot
> resell an opened product and neither would you want us to.
>
> **This does not apply if we got it wrong.** If an item arrives damaged, faulty, or isn't what
> you ordered, we replace or refund it whether it is opened or not. Message us on WhatsApp with
> your order number and a photo and we'll sort it.
>
> **Refunds are made in cash**, by the same route the order was delivered, or as store credit if
> you prefer. Since orders are paid on delivery, there is no card to refund to.
>
> Points earned on a returned order are removed with it.

**That last line is already true in the code** — a reversal claws the points back and removes
the order from tier progress. It is written here so a customer is not surprised by it.

---

## 2. Delivery

### The decision

**What can you actually promise?**

There is no courier integration and no tracking. The site currently promises nothing, which is
honest but reads as evasive — a customer deciding whether to order wants to know roughly when
it comes.

The old policy page said "2–5 working days" and that was removed during the audit precisely
because nothing backs it. So: **what is true?** How long does it actually take you to source an
item and get it to a door in Beirut, and outside Beirut?

I cannot write this sentence for you. It is the one number a customer most wants and the one I
have no way to measure.

### Draft wording

> **Delivery**
>
> We deliver across Lebanon. Delivery is **[$X]** and **free over [$Y]** — [figures come from
> Settings and are already live on the site].
>
> Because we source each order rather than holding stock, we confirm every item with you on
> WhatsApp before it goes out. Most orders reach you within **[BLANK — your real range, e.g.
> "2–4 days in Beirut and 3–6 days elsewhere"]**.
>
> **Pay when it arrives.** Cash on delivery, in US dollars. Please have the amount ready — the
> driver may not carry change.
>
> If an item turns out to be unavailable, we contact you before dispatching anything. You can
> swap it, drop it, or cancel the whole order.

**"The driver may not carry change" is worth keeping** — it is the single most common friction
in cash-on-delivery and saying it up front prevents an argument at the door.

---

## 3. Privacy

### The decision

**Is there a business behind the store, and what is it called?** A privacy policy needs a
controller — a name and a way to reach them. "TulipGlam" as a trading name is fine if that is
what it is; if there is a registered company, that name should appear.

**And: do you want an email address for privacy requests, or is WhatsApp enough?** WhatsApp is
what your customers actually use. It is also unusual on a privacy page and some people will not
trust it.

### What the store actually collects — this is now bigger than it was

I have checked rather than guessed. As of tonight:

| What | Where it comes from | Why |
|---|---|---|
| Name, phone, WhatsApp, address | checkout | to deliver the order |
| Email | checkout, registration, **and the coming-soon page** | order confirmations, and the launch announcement |
| Password (hashed, bcrypt) | registration | to let you sign back in |
| Order history | orders | so you can see what you bought |
| **Phone as a loyalty key** | any order | to attach points to a person without needing an account |
| **Birth month** (never the full date) | loyalty profile | the birthday bonus |
| Server error records | automatic | so a fault is noticed before a customer reports it |

**The coming-soon email capture went live tonight**, so the privacy page needs to cover it
before the site opens — people are being asked for an address right now.

**Nothing is shared with anyone.** There is no analytics service, no advertising pixel, no
third-party script on the storefront at all — and as of tonight the fonts are self-hosted too,
so a visitor's browser contacts nobody but this store. That is unusual and worth saying out
loud; most stores cannot.

### Draft wording

> **Privacy**
>
> **[BLANK — legal or trading name]** runs TulipGlam. If you want to know what we hold about
> you, or want it deleted, message us on WhatsApp at [number] **[or email BLANK]** and we'll
> deal with it.
>
> **What we keep, and why**
>
> When you order we keep your name, phone number, delivery address and — if you give one —
> your email, because we cannot deliver an order or tell you it has shipped without them. If
> you make an account we also keep your password, stored scrambled in a way that cannot be
> reversed, and your order history.
>
> If you join TulipGlam Rewards we keep your phone number as the thing your points attach to,
> and your **birth month** if you give it — the month only, never the date, because a birthday
> perk needs to know when, not how old.
>
> If you left your email on our coming-soon page, we keep it to tell you when we open. Nothing
> else. Reply to any message and we'll remove you.
>
> **What we don't do**
>
> We don't sell or share your details. There is no advertising or analytics service on this
> site — no tracking pixel, no third-party script, and nothing loaded from another company's
> servers. When you browse TulipGlam, your browser talks to us and to nobody else.
>
> We keep order records because we have to: they are the receipt if something goes wrong.
> Everything else we will delete if you ask.

**The "what we don't do" paragraph is unusually strong and it is entirely true today.** If
analytics is ever added, that paragraph has to change in the same commit.

---

## 4. Three smaller ones you will need

**Order confirmation copy.** The email templates exist and the outbox is queuing messages that
will send the day SMTP is configured. Nobody has read the wording. Worth ten minutes before it
starts reaching customers.

**The gift-card terms page exists but is generic.** It should say whether cards expire, whether
they are refundable, and what happens to a balance after a partial spend. The code keeps the
remaining balance indefinitely and never expires it — so if the page says otherwise, the page
is wrong.

**Rewards terms.** The rewards page states the three rules that matter (points confirm after
seven days, the rate is locked at checkout, a new tier applies from the next order). What it
does not say is that **points expire after twelve months without a confirmed order**, or that
**the shop can adjust a balance**. Both are true in the code. Both should be visible before
anyone has a balance worth arguing about.

---

## What I need from you, shortest first

1. **Returns window: 7 or 14 days?** — this one has code behind it
2. **Realistic delivery times**, Beirut and elsewhere
3. **The name that runs the business**, for the privacy page
4. **Are opened cosmetics returnable?** (I would say no, with a fault exception)
5. **Privacy contact: WhatsApp only, or an email address too?**

Answer those and the pages can go live the same day — they are settings-driven and need no
deploy.
