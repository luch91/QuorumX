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
        has_table_privilege(current_user, 'quorumx.due_diligence_assessments', 'DELETE') as due_diligence_delete,
        to_regclass('quorumx.backfill_runs') is not null
          and to_regclass('quorumx.backfill_candidates') is not null as latest_schema,
        coalesce((select not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls
          from pg_roles where rolname = 'quorumx_runtime'), false) as safe_runtime_role,
        (select count(*)::integer from pg_auth_members memberships join pg_roles roles on roles.oid = memberships.member
          where roles.rolname = 'quorumx_runtime') as runtime_memberships,
        has_table_privilege('quorumx_runtime', 'quorumx.assessments', 'UPDATE,DELETE') as accepted_v1_mutation,
        has_table_privilege('quorumx_runtime', 'quorumx.due_diligence_assessments', 'UPDATE,DELETE') as accepted_v2_mutation,
        has_table_privilege('quorumx_runtime', 'quorumx.due_diligence_assessments_v3', 'UPDATE,DELETE') as accepted_v3_mutation,
        has_table_privilege('quorumx_runtime', 'quorumx.backfill_runs', 'SELECT,INSERT,UPDATE')
          and has_table_privilege('quorumx_runtime', 'quorumx.backfill_candidates', 'SELECT,INSERT,UPDATE') as backfill_rw,
        has_schema_privilege('quorumx_runtime', 'quorumx', 'CREATE') as runtime_schema_create
    `);
    const row = result.rows[0];
    const failures = [];
    if (Number(row.table_count) < 14 || !row.latest_schema || !row.backfill_rw) failures.push("required schema or migration is missing");
    if (!row.safe_runtime_role || Number(row.runtime_memberships) !== 0) failures.push("runtime role attributes or membership are unsafe");
    if (row.accepted_v1_mutation || row.accepted_v2_mutation || row.accepted_v3_mutation) failures.push("runtime role can mutate accepted records");
    if (row.runtime_schema_create) failures.push("runtime role can create schema objects");
    if (failures.length) throw new Error(`database verification failed: ${failures.join("; ")}`);
    console.log(JSON.stringify({ ...row, verified: true }));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
