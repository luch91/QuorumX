const { Client } = require("pg");

async function main() {
  const connectionString = process.env.DATABASE_URL_UNPOOLED;
  const password = process.env.QUORUMX_DATABASE_ROLE_PASSWORD;
  if (!connectionString) throw new Error("DATABASE_URL_UNPOOLED is required");
  if (!password || password.length < 20) {
    throw new Error("QUORUMX_DATABASE_ROLE_PASSWORD must contain at least 20 characters");
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const existing = await client.query("select 1 from pg_roles where rolname = 'quorumx_runtime'");
    if (existing.rowCount) {
      console.log("quorumx_runtime already exists; no password was changed");
      return;
    }
    const statement = await client.query(
      "select format('create role quorumx_runtime with login password %L', $1::text) as sql",
      [password],
    );
    await client.query(statement.rows[0].sql);
    console.log("created quorumx_runtime");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
