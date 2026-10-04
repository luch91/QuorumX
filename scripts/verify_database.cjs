const { Client } = require("pg");

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(`
      select
        current_user,
        current_database(),
        (select count(*)::integer from information_schema.tables where table_schema = 'quorumx') as table_count,
        has_schema_privilege(current_user, 'quorumx', 'USAGE') as schema_usage,
        has_table_privilege(current_user, 'quorumx.proposals', 'SELECT,INSERT,UPDATE') as proposal_rw,
        has_table_privilege(current_user, 'quorumx.proposals', 'DELETE') as proposal_delete,
        has_table_privilege(current_user, 'quorumx.due_diligence_assessments', 'SELECT,INSERT,UPDATE') as due_diligence_rw,
        has_table_privilege(current_user, 'quorumx.due_diligence_assessments', 'DELETE') as due_diligence_delete
    `);
    console.log(JSON.stringify(result.rows[0]));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
