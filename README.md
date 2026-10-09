# Property Manager

A small, opinionated property and rental management app for landlords managing a portfolio of commercial or residential units. Built with Next.js + Supabase. Tracks properties, leases, monthly rent collection, and per-property costs — including multi-property cost splits weighted by sqft. All data lives in your own Postgres so you can query it with SQL, BI tools, or wire it up to an MCP server for natural-language analytics.

> Currency and date format defaults are KES and `dd/mm/yyyy`. Both live in `lib/format.ts` — change once, reflected everywhere.

## Features

- **Compounds → properties → leases**, with full history per property
- **Granular per-user permissions** (no fixed roles): create / edit / delete properties, put on rent, cancel rental, mark rent collected, add / delete costs, manage users. Admin flag implicitly grants everything.
- **Monthly rent collection workflow** — auto-generates "due" rows for every active lease at month start. Collect a single month (full or part-payment) or tick several rent months / charges and collect them together under one date, method and reference.
- **Payment log** (`/payments`) — every payment with date, method (M-Pesa, bank, cheque, cash), reference and who recorded it. Collected totals on rent rows, charges and deposits are only changed through it (`record_payment` / `set_collected_total` in `supabase/024`), so the history always adds up. CSV export.
- **Tenant statements** (`/rent/statement`) — per lessee or per lease: charges, payments and running balance, deposit position. Download as CSV or print / save as PDF.
- **Reminders** (`/reminders`) — who is overdue, whose lease ends soon, deposit shortfalls; a pre-written message opens in WhatsApp, SMS or email, and every reminder sent is logged.
- **Audit trail** (`/audit`, admins) — database triggers record who created, changed or deleted what, field by field.
- **Service charge handling** — stored on the property as a recurring cost. Each lease has a *"lessee pays service charge"* toggle. When on, net rent we receive auto-calculates as `gross − service_charge`; service charge is still posted as a company cost.
- **Cost splitting** — apply a cost to one property (full amount) or multiple properties (auto-split by sqft using largest-remainder rounding so allocations sum exactly).
- **Interactive analytics** (home page, and scoped inside every compound, property and lease page) — filter by period (with previous-period comparison), compound, property, client and the staff member who recorded payments; click a compound to drill into its properties, a property into its clients, a month to zoom in, an aging bucket to list what's late. KPIs with deltas and sparklines, billed-vs-received trend with collection rate, rankings by any metric, overdue aging, occupancy and lease-expiry timeline, cash-flow forecast, payment-method and staff mix, costs and lessee charges, written insights, and a sortable table at every level with CSV export. Filters live in the URL (shareable); widgets can be hidden and views saved per browser. The browser gets one compact, cached fact set (`analytics_facts`, `supabase/029`) and computes everything locally (`lib/analytics/compute.ts`), so every click is instant.
- **Excel import** — bulk-import properties and leases from a spreadsheet via a seed script.
- **Built-in MCP server** (`/api/mcp`) — connect Claude, ChatGPT or any MCP client with a per-user API key and ask about the portfolio, pull statements, or record payments. See *Querying with Claude* below.

## Stack

- [Next.js 15](https://nextjs.org) (App Router, Server Actions)
- [Supabase](https://supabase.com) — Postgres, Auth, RLS
- [Tailwind CSS](https://tailwindcss.com) + small in-house component layer
- [TypeScript](https://www.typescriptlang.org)
- [`pg`](https://node-postgres.com) for migrations and seed scripts

No paid services required. Runs locally and free on Supabase + Vercel free tiers.

## Quick start

### 1. Prerequisites

- Node.js ≥ 20
- A free [Supabase](https://supabase.com) project
- `git`

### 2. Clone and install

```bash
git clone https://github.com/varsani-akshit/property-manager.git
cd property-manager
npm install
```

### 3. Configure environment

Copy `.env.example` to `.env.local` and fill in your Supabase credentials:

```bash
cp .env.example .env.local
```

- **`DATABASE_URL`** — from Supabase dashboard → top header **Connect** button → **Session pooler** tab. Replace `[YOUR-PASSWORD]` with your database password.
  > New Supabase projects only expose IPv6 on the direct connection host. Always use the pooler URL.
- **`NEXT_PUBLIC_SUPABASE_URL`** — your project URL (`https://<ref>.supabase.co`).
- **`NEXT_PUBLIC_SUPABASE_ANON_KEY`** — the **publishable** key from Project Settings → API Keys. **Never put the secret / service_role key here** — anything prefixed `NEXT_PUBLIC_` ships to the browser.

### 4. Push the schema

```bash
npm run migrate
```

Then apply the numbered migrations in `supabase/` in order (each is idempotent), e.g.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f supabase/024_payments_audit_reminders_mcp.sql
```

This creates all tables, indexes, RLS policies, helper functions, and the auth trigger that auto-creates a `user_profiles` row on signup.

### 5. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll be redirected to `/login`.

### 6. Sign up & become admin

1. Click **Sign up** on the login page, create your account.
2. In Supabase → Table Editor → `user_profiles`, find your row and flip `is_admin` to `true`. (One-time only — afterwards you grant other users permissions from inside the app at `/users`.)
3. Refresh.

You should now see the dashboard with empty KPIs, a sidebar, and a **Users** link.

## Using the app

### Workflow

1. **Compounds → New compound** — create a top-level grouping (e.g. *"Sunrise Apartments, Westlands"*).
2. **Properties → New property** — pick a compound, enter name, area in sqft, valuation, monthly service charge (cost to you), and optional deed link.
3. **From any property → Put on rent** — fill lessee details, dates, gross rent. Toggle *"lessee pays service charge"* if applicable; the form shows net rent live.
4. **Rent Collection** — click **Generate this month** to create due rows for every active lease. Click **Mark collected** as rent comes in.
5. **Costs → Add cost** — pick one property (full amount) or several (auto-split by sqft). Service charge costs are auto-posted monthly per property via `post_monthly_service_charges()`.

### Permissions

Permissions live as boolean flags on each `user_profiles` row. Admins implicitly have all of them. To grant a teammate scoped access:

1. Have them sign up at `/login`.
2. Go to `/users` (admin only).
3. Toggle the flags that apply (e.g. *Mark rent collected* + *Add costs* but nothing else).

Available permissions:

| Flag | What it unlocks |
|---|---|
| `create_property` | Create compounds & properties |
| `edit_property` | Edit compounds & properties |
| `delete_property` | Archive properties |
| `create_lease` | Put a property on rent / edit active leases |
| `cancel_lease` | Cancel an active rental |
| `mark_rent` | Mark rent rows collected; run monthly rent generation |
| `add_cost` | Add and edit costs |
| `delete_cost` | Delete costs |
| `manage_users` | Access `/users` and change others' permissions |

### Bulk-importing from Excel

If you already track properties in a spreadsheet, you can adapt `scripts/seed.ts` to import them.

1. Convert your sheet to a JSON file at `scripts/seed_data.json` matching this shape:
   ```json
   {
     "compounds": ["Compound A", "Compound B"],
     "properties": [
       {
         "compound": "Compound A",
         "name": "Unit 1",
         "area_sqft": 1200,
         "valuation": 14000000,
         "service_charge_monthly": 10000,
         "deed_url": null
       }
     ],
     "leases": [
       {
         "compound": "Compound A",
         "property_name": "Unit 1",
         "lessee_name": "Acme Ltd",
         "contact": "+254...",
         "start_date": "2024-01-01",
         "end_date": "2026-12-31",
         "gross_rent_monthly": 80000
       }
     ]
   }
   ```
2. Run:
   ```bash
   npm run seed
   ```

The script is idempotent — running it twice won't create duplicates.

### Automating monthly rent + service charge posting

Two Postgres functions handle this:

- `generate_due_rents(p_month date default current month)` — for each active lease, inserts a `rent_collections` row with status `'due'` (and the correct net amount if the lessee pays SC).
- `post_monthly_service_charges(p_month date default current month)` — posts the monthly service charge of every property as a cost, allocated to that property.

To run them on the 1st of each month, schedule them in Supabase → Database → **Cron** (or use `pg_cron`):

```sql
select cron.schedule('rent-monthly', '0 1 1 * *', $$ select public.generate_due_rents(); $$);
select cron.schedule('sc-monthly',   '0 1 1 * *', $$ select public.post_monthly_service_charges(); $$);
```

Until then, use the **Generate this month** button on `/rent`.

## Querying with Claude (or any LLM with MCP)

The app serves its own MCP server at `/api/mcp` (Streamable HTTP, `mcp-handler`). Tools live in `lib/mcp/tools.ts` — portfolio summary, who owes what, unpaid items, lessee statements, payments, cash-flow forecast, expiring leases, rent roll, search, property / lease details, costs, service charges, the audit trail, and three writes (record a payment, collect several items in full, log a reminder).

1. An admin opens **Admin → API keys & MCP**, picks the user the key should act as, and creates a key (`vk_…`, shown once; only its SHA-256 is stored). A key has exactly its owner's permissions — tools they can't use aren't even listed — and its writes are attributed to them in the audit trail.
2. Connect a client:
   - **Claude.ai / Claude Desktop** — Settings → Connectors → *Add custom connector* → paste `https://<your-app>/api/mcp/<key>`.
   - **ChatGPT** — Settings → Apps & Connectors → Advanced → Developer mode → *Create*, same URL, no authentication.
   - **Claude Code** — `claude mcp add --transport http variaka https://<your-app>/api/mcp --header "Authorization: Bearer <key>"`.
3. Ask: *"Who owes us the most and for how long?"*, *"Give me Sunmay's statement for this year"*, *"Record Ksh 9,375 by M-Pesa ref SJK4H7Q2LP against Sunmay's August rent."*

Revoke a key on the same page; it stops working immediately.

## Architecture

```
app/
├── (app)/                      protected app behind auth middleware
│   ├── page.tsx                dashboard
│   ├── compounds/              list / new / [id] / [id]/edit
│   ├── properties/             list / new / [id] / [id]/edit
│   ├── leases/                 list / new / [id]/edit
│   ├── rent/                   rent collection workflow
│   ├── costs/                  list / new / [id]/edit
│   └── users/                  admin: permission management
├── login/                      email/password auth
└── api/
    └── leases/[id]/cancel/     server route to cancel a rental
components/                     Sidebar, Kpi, PageHeader, etc.
lib/
├── supabase/                   server + browser clients
├── permissions.ts              flag-based permission gate
└── format.ts                   KES, dd/mm/yyyy
middleware.ts                   redirects unauth → /login, auth on /login → /
supabase/
├── schema.sql                  source of truth for the DB
└── fix_rls.sql                 RLS patch (already in schema for new installs)
scripts/
├── migrate.ts                  push schema
├── seed.ts                     import seed_data.json
└── fix-rls.ts                  apply RLS patch in-place
```

### Data model

```
compounds        — top-level grouping ("Sunrise Apartments")
  └── properties — units with sqft, valuation, service charge
        └── leases — lessee + dates + gross rent + SC flag
              └── rent_collections — one row per due month

costs            — expense events (description, amount, category, date)
  └── cost_allocations — per-property share (sqft-weighted for multi-property)

user_profiles    — granular permission flags, 1:1 with auth.users
```

Money fields use `NUMERIC(14,2)`. Dates are `DATE` (displayed `dd/mm/yyyy` in the UI; parsed as ISO server-side). At most one active lease per property, enforced via a partial unique index. RLS is on; all writes are gated at the application layer via `requirePermission()`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server on `localhost:3000` |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run migrate` | Push `supabase/schema.sql` to your database |
| `npm run seed` | Import properties / leases from `scripts/seed_data.json` |

## Deploy

Any Node-hosting platform works. Easiest is Vercel:

1. Push this repo to GitHub.
2. Import into Vercel.
3. Add the same three env vars (`DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
4. Deploy.

Supabase free tier + Vercel free tier is enough for a small team and a few hundred properties. No monthly bill.

## Security notes

- **Never** put the Supabase `service_role` / `sb_secret_…` key in any `NEXT_PUBLIC_*` env var. It bypasses RLS and gives full DB access. The publishable / `sb_publishable_…` key is the one for the browser.
- RLS is enabled on every table, and `anon` has no grants in `public` — unauthenticated users can read and call nothing. The summary views run as the caller (`security_invoker`).
- Write permissions are enforced three times: in the UI (buttons hidden), in every server action / API route (`requirePermission()`), and in the database — each table's INSERT/UPDATE/DELETE policy checks `has_perm('<permission>')` against the signed-in user's flags (`supabase/027`). Reads follow permissions too (`supabase/028`, `can_read()`): each table is readable only by people whose permissions include a page that shows it, or who may write to it. Users see their own profile; colleagues' names come from the `people` view (id, name, email only).
- Money moves only through `record_payment` / `set_collected_total` (security definer, with their own permission check), so permission to record rent doesn't grant permission to edit leases or costs. The same goes for rent generation (`backfill_lease_rents`, `daily_worker`).
- `user_profiles` can only be updated by admins / user managers (`is_user_manager()`), so nobody can grant themselves permissions through the API.
- MCP API keys are stored hashed; the endpoint uses the service-role key server-side and checks the key owner's permissions on every tool.
- Bulk backfill (the one-off migration import) is switched off; set `ENABLE_BULK_BACKFILL=true` to reopen it.
- The `user_profiles` SELECT policy is permissive (all authenticated users can see other users' profiles) so the sidebar, lessee dropdowns, and `/users` page work. If you need stricter isolation, lock it down further.

## Contributing

PRs welcome. Suggested improvements that are deferred today:
- Lease renewal flow (currently: cancel + create new)
- CSV / Excel export
- Audit log UI (DB schema doesn't yet log writes)
- Charts on dashboards (numbers only today)
- Email / SMS reminders for due rent
- File upload for documents (currently: paste external links)

If you fork this, set the copyright in `LICENSE` to your own name.

## License

[MIT](./LICENSE) © 2026 Akshit Varsani
