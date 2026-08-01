# Backup and restore

Written to be followed with shaking hands. Start at the top and do what it says.

---

## If something has just gone badly wrong

**Do not run any importer. Do not run `prisma db push`. Do not delete anything.**
Those are the three things that turn a bad morning into a lost business.

**1. Take a backup of whatever is left, right now.** Even a damaged database is worth
capturing before you touch it.

```
cd server
npx tsx scripts/backup.ts
```

It is read-only and safe to run on a broken database. It writes
`server/backups/tulipglam-<timestamp>.json.gz`.

**2. Work out what actually happened** before deciding how to fix it.

```
npx tsx scripts/restore-drill.ts backups/<the file you just made>
```

The drill prints row counts per table. Compare them with what you expect. If orders are
there and only the catalogue is missing, you do **not** need a restore — see *Losing the
catalogue* below.

**3. Only then** follow *Restoring for real*.

---

## What is backed up, and what deliberately is not

| | |
|---|---|
| **Backed up** | orders, order items and events, customers, addresses, loyalty accounts and ledgers, claim decisions, gift cards, coupons, launch signups, settings, delivery areas, reviews |
| **Not backed up** | products, product images, product variants, categories, brands |

The catalogue is **reproducible**. All 9,672 products come from three importers whose source
data is committed in `../dali-import`, `../beesline-import` and `../feel22-import`. Losing it
costs an afternoon.

Orders, customers and loyalty ledgers are **not reproducible**. Lose those and you have no
record of who bought what, who is owed points, or what a gift card is worth.

That asymmetry is the whole design: the default backup runs in seconds and is a couple of
hundred kilobytes, because **a backup nobody runs is not a backup**. If you want the
catalogue too, `npx tsx scripts/backup.ts --everything` — slower, far larger, and you
almost certainly do not need it.

---

## Taking a backup

```
cd server
npx tsx scripts/backup.ts                      # default location: server/backups/
npx tsx scripts/backup.ts --dir "D:\backups"   # somewhere else
```

Read-only. Safe against production, while customers are ordering.

**`server/backups/` is gitignored on purpose.** It contains customer names, phone numbers,
addresses and email addresses. It must never be committed. Keep copies somewhere private and
off this machine — a disaster that takes the laptop takes the backups with it.

### Verify it before you trust it

```
npx tsx scripts/restore-drill.ts backups/tulipglam-....json.gz
```

The drill creates a throwaway `restore_drill` schema, rebuilds the important tables inside
it, loads the backup, checks the values survived, and drops the schema. **It never touches
your live tables.** If it fails, the file is not a backup — take another one and find out
why.

This is not ceremony. The first version of the restore path was broken in two ways and both
were found by running it: JSON has no date type, so every timestamp came back as a string
that Postgres refused to bind to a `timestamptz`; and the column parser split
`numeric(4,2)` down the middle and tried to insert into a column called `2)`. The backup
files were fine both times. The restore was not.

---

## Restoring for real

You need this when the database is gone or corrupted beyond repair.

**1. Make a new, empty Postgres database.** In Neon: create a new project or a new database.
Copy its connection string.

**2. Point the app at it.** In `server/.env`, set `DATABASE_URL` and `DIRECT_URL` to the new
database. Leave production's environment alone until step 5.

**3. Create the schema.**

```
cd server
npx prisma db push
```

This builds every table, index and constraint from `prisma/schema.prisma`. The database is
now correct but empty.

**4. Rebuild the catalogue** (it is not in the backup):

```
npm run import:dali
npm run import:beesline
npm run import:feel22        # run last — it skips products already carried direct
```

**5. Load the backup.** There is no `restore.ts` yet — see *Known gap* below. Today the
`restore-drill.ts` insert loop is the working reference for how to do it: same order of
tables, same explicit `::timestamptz` and `::numeric` casts. Restoring the transactional
tables by hand from a backup file is a job of perhaps thirty minutes with that as a guide.

**6. Check before switching over.** Count orders and customers, open a few in admin, and
confirm the loyalty balances look right. Only then point Render's `DATABASE_URL` at the new
database.

---

## Losing only the catalogue

Far more likely than losing everything, and it is not a disaster.

```
cd server
npm run import:dali
npm run import:beesline
npm run import:feel22
```

Orders keep working throughout: `OrderItem` stores a **snapshot** of the name, price and
image at the time of the order, so an order's history survives its product being deleted.
It loses only the link back to the product page.

---

## Known gaps — read this before you need it

**There is no one-command restore.** `backup.ts` and `restore-drill.ts` exist and are
proven; a `restore.ts` that writes into a live database does not. That was deliberate for
tonight: a script whose whole purpose is to overwrite production, written at 2am and never
run in anger, is more dangerous than not having one. The drill proves the data is
recoverable and shows exactly how.

**Nothing is scheduled.** Backups happen when someone runs the command. Render's free tier
has no cron, and the app's own sweep endpoint is the wrong place for this — a backup that
writes files on an ephemeral filesystem is not a backup either. Until there is somewhere to
put them, this is a manual habit: **run it before every risky change, and once a week.**

**Neon may have its own point-in-time restore.** Their paid tiers keep a history window that
would beat all of the above. Worth checking what the current plan includes — if it has
seven-day PITR, that becomes the primary recovery path and this becomes the belt to its
braces.

---

## The one-line version

```
cd server && npx tsx scripts/backup.ts && npx tsx scripts/restore-drill.ts backups/$(ls -t backups | head -1)
```

Run that before you change anything you would not want to explain.
