import { useEffect, useState } from "react";
import { adminApi, ApiError, type LoyaltyAccountDetail, type LoyaltyClaim, type LoyaltyDashboard, type LoyaltyHit, type LoyaltyLedgerRow } from "./adminApi";
import { Spinner, SearchIcon, StarIcon, UsersIcon } from "../components/ui";
import { useToast } from "./primitives/Toast";
import { money } from "./primitives/format";

/**
 * Timestamps here are ABSOLUTE, not relative.
 *
 * The rest of admin uses relativeTime ("3 days ago"), which is right for "last updated" and
 * wrong for this table: the ledger is the evidence in a dispute, and "3 days ago" stops being
 * true the moment somebody screenshots it or pastes it into WhatsApp. Reconstructing a balance
 * needs the date the thing happened.
 */
const when = (iso: string | Date | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";
};

/**
 * Anything a thumb presses is 44px at phone width, and back to the denser admin scale above
 * `sm`. This screen is read one-handed while a customer is on the phone asking why their
 * balance moved, and Approve/Reject on a claim were ~30px tall and eight apart — which is how
 * the wrong one gets pressed on a decision that grants points and is not undone from here.
 */
const TAP = "min-h-[44px] sm:min-h-0";
const FIELD = `w-full rounded-xl border border-line-strong bg-paper px-3 py-2 text-[13px] outline-none focus:border-plum ${TAP}`;

/**
 * TulipGlam Rewards — the operator's view.
 *
 * ── THIS SCREEN SHOWS THE RAW MACHINERY, ON PURPOSE ────────────────────────────────
 *
 * The customer sees "Points returned"; here it says `redemptionReversal`, with the row id, the
 * order it hung off, the multiplier applied and whoever typed their initials. The question this
 * screen exists to answer is "why does this customer have the balance they have", and it cannot
 * be answered in the customer's vocabulary.
 *
 * ── STORED vs DERIVED IS SHOWN SIDE BY SIDE ────────────────────────────────────────
 *
 * They legitimately differ. Balances are derived at read time and the sweep writes them down
 * opportunistically, so on a server that has been asleep the stored row is behind. An operator
 * who does not know that reads a mismatch as corruption and starts "fixing" it by hand. The
 * derived figure is the truth; the stored one is a cache, and the difference is labelled.
 */
export function AdminLoyalty() {
  const [dash, setDash] = useState<LoyaltyDashboard | null>(null);
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<LoyaltyHit[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const { push } = useToast();

  useEffect(() => { adminApi.loyaltyDashboard().then(setDash).catch(() => setDash(null)); }, []);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!term.trim()) { setHits(null); return; }
    try { setHits((await adminApi.loyaltyAccounts(term.trim())).accounts); }
    catch (err) { push("error", (err as Error).message); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="serif text-2xl text-ink">Rewards</h1>
        <p className="text-[13px] text-muted">Balances, ledgers, corrections and what the programme is costing.</p>
      </div>

      {dash && <Liability dash={dash} />}

      <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">Find an account</h2>
        <form onSubmit={search} className="mt-3 flex gap-2">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Phone number — any format"
              className={`w-full rounded-xl border border-line-strong bg-paper py-2.5 pl-9 pr-3 text-[14px] outline-none focus:border-plum ${TAP}`}
            />
          </div>
          <button type="submit" className={`btn btn-primary px-5 py-2.5 text-[13px] ${TAP}`}>Search</button>
        </form>
        {/* Says what it does, because "03 123 456" finding "+9613123456" looks like magic
            otherwise, and an operator who thinks the search is literal will format by hand. */}
        <p className="mt-2 text-[12px] text-muted">
          Searched through the same normaliser that keys every account — 03 123 456, +9613123456 and 0096133123456 all find the same one.
        </p>

        {hits !== null && (
          hits.length === 0
            ? <p className="mt-4 rounded-xl border border-dashed border-line-strong p-4 text-center text-[13px] text-muted">No account for that number. One opens automatically with the customer's first order.</p>
            : (
              <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line">
                {hits.map((h) => (
                  <li key={h.id}>
                    <button onClick={() => setOpenId(h.id)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-soft">
                      <div className="min-w-0">
                        <p className="text-[14px] font-medium text-ink">{h.phoneDisplay}</p>
                        {/* Wraps below sm rather than truncating: an email clipped with no
                            title attribute is unrecoverable on a phone. */}
                        <p className="break-words text-[13px] leading-snug text-muted sm:truncate sm:text-[12px]">
                          {h.customerId ? `${h.customerName} · ${h.customerEmail}` : "Not linked to a login"}
                        </p>
                      </div>
                      <span className="shrink-0 text-[12px] text-muted">{h.tier} · #{h.id}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
        )}
      </section>

      {openId !== null && <AccountPanel id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/**
 * What the programme costs.
 *
 * Liability is confirmed points times what a point is worth when redeemed. It deliberately does
 * NOT model breakage or subtract points about to expire: both would make the number smaller, both
 * are guesses, and an owner deciding whether this is affordable should see the figure that
 * assumes everybody redeems.
 */
function Liability({ dash }: { dash: LoyaltyDashboard }) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat
        label="Outstanding liability"
        value={money(dash.liabilityCents)}
        note={`${dash.outstandingPoints.toLocaleString()} confirmed points at ${money(dash.centsPerPoint)} each`}
        strong
      />
      <Stat
        label="Not yet a liability"
        value={money(dash.pendingLiabilityCents)}
        note={`${dash.pendingPoints.toLocaleString()} points still inside the 7-day hold`}
      />
      <Stat
        label={`Issued in ${dash.monthLabel}`}
        value={dash.issuedThisMonth.toLocaleString()}
        note={`${dash.redeemedThisMonth.toLocaleString()} redeemed · ${dash.expiredThisMonth.toLocaleString()} expired`}
      />
      <Stat
        label="Accounts"
        value={dash.accounts.toLocaleString()}
        note={`${dash.linkedAccounts.toLocaleString()} linked to a login`}
      />
      <div className="rounded-2xl border border-line bg-surface p-4 sm:col-span-2 lg:col-span-4">
        <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">Tiers</p>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          {dash.tiers.map((t) => (
            <div key={t.key} className="flex items-baseline gap-2">
              <StarIcon className="h-3.5 w-3.5 text-plum" />
              <span className="text-[14px] font-medium text-ink">{t.label}</span>
              <span className="text-[13px] text-muted">{t.count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, note, strong = false }: { label: string; value: string; note: string; strong?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${strong ? "border-plum/30 bg-plum-soft/40" : "border-line bg-surface"}`}>
      <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className="serif mt-1 text-2xl text-ink">{value}</p>
      <p className="mt-1 text-[12px] leading-snug text-muted">{note}</p>
    </div>
  );
}

function AccountPanel({ id, onClose }: { id: number; onClose: () => void }) {
  const { push } = useToast();
  const [data, setData] = useState<LoyaltyAccountDetail | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    adminApi.loyaltyAccount(id).then((d) => { if (live) setData(d); }).catch((e) => push("error", (e as Error).message));
    return () => { live = false; };
  }, [id, reload, push]);

  if (!data) return <div className="grid place-items-center py-12 text-plum"><Spinner /></div>;

  const drifted = data.stored.balanceCached !== data.derived.balance;

  return (
    <section className="rounded-2xl border border-line bg-surface">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-4 sm:p-5">
        <div>
          <h2 className="serif text-xl text-ink">{data.phoneDisplay}</h2>
          <p className="text-[12px] text-muted">
            Account #{data.id} · opened {when(data.createdAt)}
            {data.customer ? ` · ${data.customer.fullName} (${data.customer.email})` : " · not linked to a login"}
          </p>
        </div>
        <button onClick={onClose} className={`btn btn-ghost px-4 py-2 text-[13px] ${TAP}`}>Close</button>
      </header>

      <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-3">
        <div className="rounded-xl border border-plum/30 bg-plum-soft/40 p-4">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-plum">Spendable now (derived)</p>
          <p className="serif mt-1 text-3xl text-ink">{data.derived.balance}</p>
          <p className="mt-1 text-[12px] text-muted">{data.derived.pending} pending · {money(data.derived.windowSpendCents)} spend in window</p>
        </div>
        <div className="rounded-xl border border-line p-4">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">Stored on the row</p>
          <p className="serif mt-1 text-3xl text-muted">{data.stored.balanceCached}</p>
          {/* The reassurance that stops somebody "fixing" a cache. */}
          <p className="mt-1 text-[12px] text-muted">
            {drifted
              ? "Behind the derived figure — the sweep has not run since something matured. Not a fault."
              : "In step with the derived figure."}
          </p>
        </div>
        <div className="rounded-xl border border-line p-4">
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">Tier</p>
          <p className="serif mt-1 text-3xl text-ink">{data.derived.tier}</p>
          <p className="mt-1 text-[12px] text-muted">
            qualifies for {data.derived.qualifiesFor} · held since {when(data.derived.tierEarnedAt)}
          </p>
        </div>
      </div>

      {data.redemptionBlocked && (
        <p className="mx-4 mb-4 rounded-xl border border-sale/40 bg-sale/5 p-3 text-[13px] text-ink sm:mx-5">
          Redemption is paused on this account — {data.refusalCount} refused deliveries. Review before lifting it.
        </p>
      )}

      {(data.derived.pendingWrites.confirm > 0 || data.derived.pendingWrites.expirePoints > 0 || data.derived.pendingWrites.tierChange) && (
        <div className="mx-4 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line-strong bg-soft p-3 sm:mx-5">
          <p className="text-[13px] text-ink">
            The sweep would write {data.derived.pendingWrites.confirm} confirmation(s)
            {data.derived.pendingWrites.expirePoints > 0 ? `, expire ${data.derived.pendingWrites.expirePoints} points` : ""}
            {data.derived.pendingWrites.tierChange ? `, and move the tier to ${data.derived.pendingWrites.tierChange}` : ""}.
            No customer-visible number changes.
          </p>
          <button
            onClick={async () => {
              try { await adminApi.loyaltyMaterialise(id); push("ok", "Written down."); setReload((n) => n + 1); }
              catch (e) { push("error", (e as Error).message); }
            }}
            className={`btn btn-ghost w-full px-4 py-2 text-[13px] sm:w-auto ${TAP}`}
          >Write it down now</button>
        </div>
      )}

      <Claims accountId={id} title="Guest orders matching this phone" rows={data.claims.guest} onDone={() => setReload((n) => n + 1)}
        blurb="Matched on phone only. Anyone can type a stranger's number at checkout, so a match is a candidate — you decide." />
      <Claims accountId={id} title="Their own orders from before the programme" rows={data.claims.signedIn} onDone={() => setReload((n) => n + 1)}
        blurb="Placed while signed in, so the identity is already settled. The decision is whether an order from before launch should earn." />

      <Adjust accountId={id} onDone={() => setReload((n) => n + 1)} />
      <Ledger entries={data.entries} />
    </section>
  );
}

function Claims({ accountId, title, rows, blurb, onDone }: {
  accountId: number; title: string; rows: LoyaltyClaim[]; blurb: string; onDone: () => void;
}) {
  const { push } = useToast();
  const [by, setBy] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(0);
  if (rows.length === 0) return null;

  const rule = async (orderId: number, decision: "approved" | "rejected") => {
    setBusy(orderId);
    try {
      const r = await adminApi.loyaltyDecideClaim(accountId, orderId, { decision, decidedBy: by, note });
      push("ok", decision === "approved" ? `Approved — ${r.granted} points granted.` : "Rejected.");
      setNote("");
      onDone();
    } catch (e) {
      push("error", e instanceof ApiError ? e.message : (e as Error).message);
    } finally { setBusy(0); }
  };

  return (
    <div className="border-t border-line p-4 sm:p-5">
      <h3 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">{title}</h3>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">{blurb}</p>

      <div className="mt-3 grid gap-2 sm:grid-cols-[120px_1fr]">
        <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Your initials" className={FIELD} />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why — recorded against the decision" className={FIELD} />
      </div>
      <p className="mt-1 text-[12px] text-muted">Initials are not verified — they identify who to ask, not who is authorised.</p>

      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line">
        {rows.map((c) => (
          /* Below sm the decision becomes a full-width footer under the order it decides, the
             way a dispatch card carries its actions. Two 12px pills sitting inline at the end
             of a wrapped row are the smallest, most crowded thing on the screen — and the one
             press here is irreversible from this form. */
          <li key={c.orderId} className="px-4 py-3 sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
            <div className="min-w-0">
              <p className="text-[14px] font-medium text-ink">{c.number} · {money(c.merchandiseCents)} · {c.basePoints} pts</p>
              <p className="text-[13px] leading-snug text-muted sm:text-[12px]">
                {c.customerName} · delivered {c.deliveredAt ? when(c.deliveredAt) : "—"} · matched on {c.matchedOn}
              </p>
            </div>
            {c.decision ? (
              <p className="mt-1.5 text-[13px] text-muted sm:mt-0 sm:shrink-0 sm:text-[12px]">
                {c.decision.decision} by {c.decision.decidedBy || "—"} · {when(c.decision.decidedAt)}
              </p>
            ) : (
              <div className="mt-3 flex gap-2 border-t border-line pt-3 sm:mt-0 sm:border-0 sm:pt-0">
                <button disabled={busy === c.orderId} onClick={() => rule(c.orderId, "rejected")}
                  className={`btn btn-ghost flex-1 px-4 text-[13px] sm:flex-none sm:px-3 sm:py-1.5 sm:text-[12px] ${TAP}`}>Reject</button>
                <button disabled={busy === c.orderId} onClick={() => rule(c.orderId, "approved")}
                  className={`btn btn-primary flex-1 px-4 text-[13px] sm:flex-none sm:px-3 sm:py-1.5 sm:text-[12px] ${TAP}`}>Approve</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Adjust({ accountId, onDone }: { accountId: number; onDone: () => void }) {
  const { push } = useToast();
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  const [by, setBy] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await adminApi.loyaltyAdjust(accountId, { points: Number(points), reason, enteredBy: by });
      push("ok", "Adjustment recorded.");
      setPoints(""); setReason("");
      onDone();
    } catch (err) {
      push("error", (err as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="border-t border-line p-4 sm:p-5">
      <h3 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">Correction</h3>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">
        Appends an entry — it never edits history. Negative removes points. The reason is what makes this
        reconstructable a year from now, so it is required and it is shown to nobody but you.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-[110px_110px_1fr_auto]">
        <input value={points} onChange={(e) => setPoints(e.target.value)} placeholder="±points" inputMode="numeric" className={FIELD} />
        <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Initials" className={FIELD} />
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (at least 8 characters)" className={FIELD} />
        <button disabled={busy} type="submit" className={`btn btn-primary px-5 py-2 text-[13px] ${TAP}`}>Record</button>
      </div>
    </form>
  );
}

/** The ledger, raw. Every column an operator needs to reconstruct how a balance got where it is. */
function Ledger({ entries }: { entries: LoyaltyAccountDetail["entries"] }) {
  return (
    <div className="border-t border-line p-4 sm:p-5">
      <h3 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-muted">Ledger</h3>
      <p className="mt-1 text-[12px] text-muted">Newest first, most recent 200. Append-only — the balance is the sum of these rows.</p>

      {/*
        TWO RENDERINGS OF THE SAME ROWS. Below 640px, cards.

        This was one nine-column table in a 720px horizontal scroller, and the column carrying
        the answer — Reason — was `max-w-[260px] truncate` with the full text only in a `title`
        attribute. A phone fires no hover, so on the device the operator is actually holding
        while a customer asks why their balance moved, the reason was unreadable at any width
        and by any gesture. On the card it is set in full and never clipped.

        The points delta leads because it is the one figure the question is about; the row id,
        multiplier and initials drop to provenance size — they identify the entry afterwards,
        they are not what is being read.
      */}
      <ul className="mt-3 space-y-3 sm:hidden">
        {entries.map((e) => <EntryCard key={e.id} e={e} />)}
      </ul>

      <div className="mt-3 hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[720px] text-[13px]">
          <thead className="border-b border-line text-left text-[12px] uppercase tracking-wide text-muted">
            <tr>
              <th className="py-2 pr-3 font-semibold">#</th>
              <th className="py-2 pr-3 font-semibold">Type</th>
              <th className="py-2 pr-3 font-semibold">Status</th>
              <th className="py-2 pr-3 text-right font-semibold">Points</th>
              <th className="py-2 pr-3 text-right font-semibold">×</th>
              <th className="py-2 pr-3 font-semibold">Order</th>
              <th className="py-2 pr-3 font-semibold">Reason</th>
              <th className="py-2 pr-3 font-semibold">By</th>
              <th className="py-2 font-semibold">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {entries.map((e) => (
              <tr key={e.id} className={e.status === "void" ? "text-muted line-through" : ""}>
                <td className="py-2 pr-3 tabular-nums text-muted">{e.id}</td>
                <td className="py-2 pr-3 font-medium text-ink">{e.type}</td>
                <td className="py-2 pr-3">{e.status}</td>
                <td className={`py-2 pr-3 text-right tabular-nums font-semibold ${e.points < 0 ? "text-sale" : "text-ink"}`}>{e.points > 0 ? "+" : ""}{e.points}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-muted">{e.multiplierApplied}</td>
                <td className="py-2 pr-3 text-muted">{e.orderNumber ?? "—"}</td>
                <td className="max-w-[260px] truncate py-2 pr-3 text-muted" title={e.reason}>{e.reason}</td>
                <td className="py-2 pr-3 text-muted">{e.enteredBy || "—"}</td>
                <td className="py-2 whitespace-nowrap text-muted">{when(e.confirmedAt ?? e.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {entries.length === 0 && (
        <p className="mt-3 flex items-center gap-2 text-[13px] text-muted"><UsersIcon className="h-4 w-4" /> Nothing yet — this account has never earned.</p>
      )}
    </div>
  );
}

/**
 * One ledger entry, as read on a phone.
 *
 * A void entry is struck through and dimmed rather than removed — the table does the same, and
 * an entry that was reversed is part of how the balance got where it is.
 */
function EntryCard({ e }: { e: LoyaltyLedgerRow }) {
  const voided = e.status === "void";
  return (
    <li className={`rounded-2xl border border-line bg-surface p-4 ${voided ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-[15px] font-medium leading-tight text-ink ${voided ? "line-through" : ""}`}>{e.type}</p>
          <p className="mt-0.5 text-[11px] uppercase tracking-[0.14em] text-muted">{e.status}</p>
        </div>
        <p className={`serif shrink-0 text-[26px] font-medium leading-none tabular ${e.points < 0 ? "text-sale" : "text-ink"} ${voided ? "line-through" : ""}`}>
          {e.points > 0 ? "+" : ""}{e.points}
        </p>
      </div>

      {/* In full. This is the sentence the operator came here to read. */}
      {e.reason && <p className="mt-2 break-words text-[13px] leading-snug text-ink">{e.reason}</p>}

      {e.orderNumber && <p className="mt-1.5 text-[13px] text-muted">Order {e.orderNumber}</p>}

      <p className="mt-2 text-[12px] text-muted">
        {e.confirmedAt ? "Confirmed" : "Created"} {when(e.confirmedAt ?? e.createdAt)}
      </p>
      <p className="mt-0.5 text-[11px] text-muted">
        #{e.id} · ×{e.multiplierApplied}{e.enteredBy ? ` · by ${e.enteredBy}` : ""}
      </p>
    </li>
  );
}
