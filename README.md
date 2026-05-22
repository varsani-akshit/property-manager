# Property Manager

A small, opinionated property and rental management app for landlords managing a portfolio of commercial or residential units. Built with Next.js + Supabase. Tracks properties, leases, monthly rent collection, and per-property costs — including multi-property cost splits weighted by sqft. All data lives in your own Postgres so you can query it with SQL, BI tools, or wire it up to an MCP server for natural-language analytics.

> Currency and date format defaults are KES and `dd/mm/yyyy`. Both live in `lib/format.ts` — change once, reflected everywhere.

## Features

- **Compounds → properties → leases**, with full history per property
- **Granular per-user permissions** (no fixed roles): create / edit / delete properties, put on rent, cancel rental, mark rent collected, add / delete costs, manage users. Admin flag implicitly grants everything.
- **Monthly rent collection workflow** — auto-generates "due" rows for every active lease at month start; one-click "mark collected" per row.
- **Service charge handling** — stored on the property as a recurring cost. Each lease has a *"lessee pays service charge"* toggle. When on, net rent we receive auto-calculates as `gross − service_charge`; service charge is still posted as a company cost.
- **Cost splitting** — apply a cost to one property (full amount) or multiple properties (auto-split by sqft using largest-remainder rounding so allocations sum exactly).
- **Dashboards** at three levels: portfolio-wide, per-compound, per-property — KPIs for valuation, monthly expected rent, collected vs outstanding, costs, net, ROI.
- **Excel import** — bulk-import properties and leases from a spreadsheet via a seed script.
- **MCP-ready** — Postgres-backed, so you can hook up the [Supabase MCP server](https://github.com/supabase-community/supabase-mcp) and let Claude / your LLM of choice answer questions like *"what was my YTD return on Block A?"* by writing SQL itself.

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

Because all your data sits in Postgres, you can hook up the [Supabase MCP server](https://github.com/supabase-community/supabase-mcp) and ask natural-language questions. Add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server-supabase@latest",
               "--project-ref=<your-project-ref>",
               "--read-only"],
      "env": { "SUPABASE_ACCESS_TOKEN": "<personal access token>" }
    }
  }
}
```

Then ask:

- *"What's my YTD return on the Sunrise compound?"*
- *"Which rents are uncollected this month?"*
- *"What did I spend on maintenance last quarter?"*

The LLM writes the SQL itself.

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
- RLS is enabled on every table — unauthenticated users can read nothing.
- Write permissions are enforced both in the UI (buttons hidden) and on the server (every server action / API route calls `requirePermission()`).
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
