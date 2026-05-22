import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env" });
config({ path: ".env.local", override: true });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = readFileSync(resolve("supabase/schema.sql"), "utf8");

const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();
  console.log("connected — pushing schema...");
  await client.query(sql);
  console.log("schema pushed ok");
  await client.end();
}

main().catch((e) => {
  console.error("migration failed:", e.message);
  process.exit(1);
});
