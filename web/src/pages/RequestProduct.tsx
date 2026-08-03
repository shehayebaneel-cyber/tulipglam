import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useStore } from "../lib/store";
import { ChevronRight, CheckIcon } from "../components/ui";

/**
 * "Can you get me…" — a customer asking for something the shop does not carry.
 *
 * ── WHY THIS SHOP CAN OFFER IT HONESTLY ────────────────────────────────────────────
 *
 * The business holds no inventory and sources every order after it is placed. So "we don't
 * stock that" was never the true answer — the true answer is "ask, and we'll see". Most shops
 * cannot say that without lying. This one can, and had no way for anyone to take it up.
 *
 * ── THE COPY PROMISES EFFORT, NEVER OUTCOME ────────────────────────────────────────
 *
 * No price, no date, no "we'll get it for you". The supply chain is three retail feeds and a
 * phone, and this codebase has spent months deleting claims that nothing backs — it would be a
 * poor joke to add a new one on a page whose whole purpose is to start an honest conversation.
 * "We'll look and let you know" is keepable. Anything stronger is not.
 *
 * ── THE FORM ASKS FOR AS LITTLE AS IT CAN ──────────────────────────────────────────
 *
 * One required text field and a phone number. Everything else is optional. A request form that
 * demands a name, an email, a brand and a category collects better records and receives fewer
 * requests, and the requests are the point.
 */
export function RequestProduct() {
  const { site, customer } = useStore();
  const [params] = useSearchParams();

  // Arrived from an empty search: the term is carried through and pre-filled, because retyping
  // what you just searched for is exactly the friction that stops someone bothering.
  const searchTerm = params.get("q") ?? "";
  const source = params.get("from") === "search" ? "search" : params.get("from") === "404" ? "404" : "page";

  const [wanted, setWanted] = useState(searchTerm);
  const [note, setNote] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState(customer?.email ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true); setErrors({}); setFailed("");
    try {
      const token = localStorage.getItem("tg_token");
      const res = await fetch("/api/product-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ wanted, note, phone, email, source, searchTerm }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Field messages come back from the server, which is the only place that decides what
        // is valid. Mirroring those rules here would give two answers that drift apart.
        setErrors(body.errors ?? {});
        if (!body.errors) setFailed(body.error ?? "That didn't send. Please try again.");
        return;
      }
      setSent(true);
    } catch {
      setFailed("That didn't send — check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="wrap flex flex-col items-center px-6 py-20 text-center sm:py-28">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-plum-soft text-plum">
          <CheckIcon className="h-7 w-7" />
        </span>
        <h1 className="t-title mt-5 text-ink">Got it</h1>
        <p className="t-body measure mt-2 text-muted">
          We’ll look into it and message you on WhatsApp either way — including if we can’t get it.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
          <Link to="/shop" className="btn btn-primary btn-cta px-7 py-3.5">Keep browsing</Link>
          <button
            type="button"
            onClick={() => { setSent(false); setWanted(""); setNote(""); }}
            className="btn btn-ghost px-6 py-3.5 text-[13px]"
          >
            Request something else
          </button>
        </div>
      </div>
    );
  }

  const field = (name: string) =>
    `field ${errors[name] ? "border-sale focus:border-sale" : ""}`;

  return (
    <div className="wrap py-6 sm:py-8">
      <nav className="mb-4 flex flex-wrap items-center gap-1 text-[12px] text-muted">
        <Link to="/" className="hover:text-plum">Home</Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="text-ink/70">Request a product</span>
      </nav>

      <div className="mx-auto max-w-lg">
        <div className="section-head">
          <p className="eyebrow">Can’t find it?</p>
          <h1 className="t-title text-ink">Ask us to get it</h1>
          <p className="t-body measure text-muted">
            We don’t hold stock — every order is sourced after you place it. So if something isn’t
            listed, it’s worth asking. Tell us what you’re after and we’ll see what we can do.
          </p>
        </div>

        {searchTerm && (
          <p className="mt-4 rounded-xl bg-soft px-4 py-3 text-[13px] text-muted">
            You searched for <span className="font-semibold text-ink">“{searchTerm}”</span> and we
            had nothing. We’ve filled it in below — edit it if it wasn’t quite right.
          </p>
        )}

        <form onSubmit={submit} className="panel mt-6 space-y-4 p-5">
          <div>
            <label htmlFor="wanted" className="mb-1 block text-[13px] font-semibold text-ink">
              What are you looking for?
            </label>
            <input
              id="wanted"
              value={wanted}
              onChange={(e) => setWanted(e.target.value)}
              placeholder="Brand and product, or just describe it"
              className={field("wanted")}
              autoFocus={!searchTerm}
            />
            {errors.wanted && <p className="mt-1 text-[12px] text-sale">{errors.wanted}</p>}
          </div>

          <div>
            <label htmlFor="note" className="mb-1 block text-[13px] font-semibold text-ink">
              Anything else? <span className="font-normal text-muted">Optional</span>
            </label>
            <textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Shade, size, or a link if you have one"
              className={field("note")}
            />
            {errors.note && <p className="mt-1 text-[12px] text-sale">{errors.note}</p>}
          </div>

          <div>
            <label htmlFor="phone" className="mb-1 block text-[13px] font-semibold text-ink">
              Your WhatsApp number
            </label>
            <input
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              placeholder="03 123 456"
              className={field("phone")}
            />
            {errors.phone
              ? <p className="mt-1 text-[12px] text-sale">{errors.phone}</p>
              : <p className="mt-1 text-[12px] text-muted">This is how we’ll reply.</p>}
          </div>

          <div>
            <label htmlFor="email" className="mb-1 block text-[13px] font-semibold text-ink">
              Email <span className="font-normal text-muted">Optional</span>
            </label>
            <input
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              inputMode="email"
              className={field("email")}
            />
            {errors.email && <p className="mt-1 text-[12px] text-sale">{errors.email}</p>}
          </div>

          {failed && <p className="text-[13px] text-sale">{failed}</p>}

          <button type="submit" disabled={sending} className="btn btn-primary btn-cta w-full py-3.5">
            {sending ? "Sending…" : "Send request"}
          </button>

          {/*
            Says what happens next and nothing about whether it will work. The shop cannot know
            that when the form is submitted, and a page that guessed would be making exactly the
            kind of promise the rest of this site had to have removed.
          */}
          <p className="t-micro text-muted">
            We’ll message you on WhatsApp either way — including if we can’t get it. No account
            needed, and we won’t add you to anything.
          </p>
        </form>

        {site?.settings.whatsappNumber && (
          <p className="mt-4 text-center text-[13px] text-muted">
            In a hurry? <Link to="/contact" className="font-semibold text-plum hover:underline">Message us directly</Link>.
          </p>
        )}
      </div>
    </div>
  );
}
