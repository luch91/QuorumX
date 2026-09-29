const { createHash } = require("node:crypto");
const { readdir, readFile } = require("node:fs/promises");
const path = require("node:path");
const { Client } = require("pg");

async function main() {
  const connectionString = process.env.DATABASE_URL_UNPOOLED;
  if (!connectionString) {
    throw new Error("DATABASE_URL_UNPOOLED is required for migrations");
  }
  if (new URL(connectionString).hostname.includes("-pooler")) {
    throw new Error("Migrations require a direct Neon connection, not a pooled endpoint");
  }

  const directory = path.resolve(__dirname, "..", "database", "migrations");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query(`
      create table if not exists public.quorumx_schema_migrations (
        name text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )
    `);

    for (const file of files) {
      const sql = await readFile(path.join(directory, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query(
        "select checksum from public.quorumx_schema_migrations where name = $1",
        [file],
      );
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum) {
          throw new Error(`Applied migration ${file} has been modified`);
        }
        console.log(`already applied: ${file}`);
        continue;
      }

      await client.query("begin");
      try {
        await client.query(sql);
        await client.query(
          "insert into public.quorumx_schema_migrations (name, checksum) values ($1, $2)",
          [file, checksum],
        );
        await client.query("commit");
        console.log(`applied: ${file}`);
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
