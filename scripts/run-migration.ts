// Apply a specific migration file: npx tsx scripts/run-migration.ts <file>
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env" });

const file = process.argv[2];
if (!file) {
  console.error("usage: tsx scripts/run-migration.ts <path-to-sql>");
  process.exit(1);
}

const sql = readFileSync(resolve(file), "utf8");
const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  await client.connect();
  await client.query(sql);
  console.log(`applied ${file}`);
  await client.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
