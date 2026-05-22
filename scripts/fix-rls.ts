import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env" });
const sql = readFileSync(resolve("supabase/fix_rls.sql"), "utf8");
const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  await client.connect();
  await client.query(sql);
  const { rows } = await client.query("select id, email, is_admin from public.user_profiles");
  console.log("user_profiles rows:", rows);
  await client.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
