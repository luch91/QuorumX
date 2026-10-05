const { randomBytes } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { mkdir, readFile, rm, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { Client } = require("pg");

const root = path.resolve(__dirname, "..");
const catalogPath = path.join(root, "fixtures", "organizations", "velvet-solace.json");
const runPattern = /^[0-9]{8}t[0-9]{6}z-[a-z0-9]{6,16}$/;

function value(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function generatedRunId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "z").toLowerCase();
  return `${stamp}-${randomBytes(4).toString("hex")}`;
}

function validateRunId(runId) {
  if (!runId || !runPattern.test(runId)) throw new Error("invalid run id: expected yyyymmddthhmmssz-<lowercase suffix>");
  return runId;
}

async function catalog() {
  return JSON.parse(await readFile(catalogPath, "utf8"));
}

async function manifest(runId) {
  const fixture = await catalog();
  return {
    schemaVersion: 1,
    runId,
    environment: "local",
    organization: {
      displayName: fixture.displayName,
      slug: `${fixture.baseSlug}-${runId}`,
      ownershipMarker: fixture.ownershipMarker,
      sourceKey: `snapshot:${fixture.baseSlug}-${runId}.test`,
    },
    fixtures: Object.fromEntries(fixture.proposals.map((proposal) => [proposal.fixtureId, {
      name: proposal.name,
      purpose: proposal.purpose,
      canonicalId: `snapshot:${fixture.baseSlug}-${runId}.test:${proposal.fixtureId}`,
    }])),
    createdAt: new Date().toISOString(),
    cleanupDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

function docker(args, allowFailure = false) {
  const binary = process.env.QUORUMX_DOCKER_BIN || "docker";
  const result = spawnSync(binary, args, { cwd: root, encoding: "utf8", timeout: 120_000 });
  if (!allowFailure && (result.status !== 0 || result.error)) {
    throw new Error(`docker ${args[0]} failed: ${(result.stderr || result.error?.message || result.stdout).trim()}`);
  }
  return result;
}

async function waitForDatabase(connectionString) {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    const client = new Client({ connectionString, connectionTimeoutMillis: 1_000 });
    try {
      await client.connect();
      await client.query("select 1");
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`PostgreSQL did not become ready: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function seedDatabase(runtimeUrl, runId) {
  const fixture = await catalog();
  const sourceKey = `snapshot:${fixture.baseSlug}-${runId}.test`;
  const client = new Client({ connectionString: runtimeUrl });
  await client.connect();
  try {
    await client.query("begin");
    const source = await client.query(`
      insert into quorumx.sources (
        source_key, kind, display_name, configuration, enabled, poll_interval_seconds,
        homepage_url, ecosystems, assessment_enabled, daily_assessment_budget
      ) values ($1, 'snapshot', $2, $3::jsonb, true, 300, $4, '[\"test\"]'::jsonb, false, 0)
      returning id
    `, [sourceKey, fixture.displayName, JSON.stringify({ space: `${fixture.baseSlug}-${runId}.test`, runId, ownershipMarker: fixture.ownershipMarker }), "https://example.invalid/velvet-solace"]);
    const sourceId = source.rows[0].id;
    for (let index = 0; index < fixture.proposals.length; index += 1) {
      const proposal = fixture.proposals[index];
      const canonicalId = `snapshot:${fixture.baseSlug}-${runId}.test:${proposal.fixtureId}`;
      await client.query(`
        insert into quorumx.proposals (
          source_id, external_id, canonical_id, title, body_text, choices,
          linked_evidence_urls, status, voting_ends_at, canonical_url, assessment_eligible
        ) values ($1, $2, $3, $4, $5, '[\"For\",\"Against\"]'::jsonb, '[]'::jsonb, $6,
          now() + (($7 + 1) * interval '1 day'), $8, $9)
      `, [sourceId, proposal.fixtureId, canonicalId, proposal.name, `${proposal.name}: ${proposal.purpose}`, proposal.status, index, `https://snapshot.org/#/${fixture.baseSlug}-${runId}.test/proposal/${proposal.fixtureId}`, proposal.status === "active"]);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

async function provisionDatabase(runId, runDirectory, result) {
  const container = `quorumx-e2e-${runId}`;
  const adminPassword = randomBytes(24).toString("base64url");
  const runtimePassword = randomBytes(24).toString("base64url");
  const databaseName = `quorumx_${runId.replace(/[^a-z0-9]/g, "_")}`;
  let created = false;
  try {
    const started = docker([
      "run", "--detach", "--name", container,
      "--label", `quorumx.e2e.run=${runId}`,
      "--env", `POSTGRES_PASSWORD=${adminPassword}`,
      "--env", `POSTGRES_DB=${databaseName}`,
      "--publish", "127.0.0.1::5432",
      "postgres:16-alpine",
    ]);
    created = true;
    if (process.env.QUORUMX_E2E_FAIL_AFTER === "container") throw new Error("forced failure after container");
    const containerId = started.stdout.trim();
    const portOutput = docker(["port", container, "5432/tcp"]).stdout.trim();
    const port = Number(portOutput.slice(portOutput.lastIndexOf(":") + 1));
    if (!Number.isInteger(port) || port < 1) throw new Error("Docker did not publish a PostgreSQL port");
    const adminUrl = `postgresql://postgres:${encodeURIComponent(adminPassword)}@127.0.0.1:${port}/${databaseName}`;
    const runtimeUrl = `postgresql://quorumx_runtime:${encodeURIComponent(runtimePassword)}@127.0.0.1:${port}/${databaseName}`;
    await waitForDatabase(adminUrl);
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    const escapedPassword = runtimePassword.replace(/'/g, "''");
    await admin.query(`
      do $$
      declare membership record;
      begin
        if not exists (select 1 from pg_roles where rolname = 'quorumx_runtime') then
          create role quorumx_runtime login;
        end if;
        alter role quorumx_runtime with login password '${escapedPassword}' nosuperuser nocreatedb nocreaterole noinherIT noreplication nobypassrls;
        for membership in
          select roles.rolname from pg_auth_members memberships
          join pg_roles members on members.oid = memberships.member
          join pg_roles roles on roles.oid = memberships.roleid
          where members.rolname = 'quorumx_runtime'
        loop
          execute format('revoke %I from quorumx_runtime', membership.rolname);
        end loop;
      end $$
    `);
    await admin.end();
    const migration = spawnSync(process.execPath, [path.join(root, "scripts", "migrate_database.cjs")], {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, DATABASE_URL_UNPOOLED: adminUrl },
    });
    if (migration.status !== 0) throw new Error(`migration failed: ${(migration.stderr || migration.stdout).trim()}`);
    if (process.env.QUORUMX_E2E_FAIL_AFTER === "migration") throw new Error("forced failure after migration");
    await seedDatabase(runtimeUrl, runId);
    if (process.env.QUORUMX_E2E_FAIL_AFTER === "seed") throw new Error("forced failure after seed");
    const state = { runId, container, containerId, adminUrl, runtimeUrl, databaseName, createdAt: new Date().toISOString() };
    await writeFile(path.join(runDirectory, "state.json"), `${JSON.stringify(state)}\n`, { flag: "wx", mode: 0o600 });
    return {
      ...result,
      services: { database: { engine: "postgres:16-alpine", container, host: "127.0.0.1", port, databaseName } },
    };
  } catch (error) {
    if (created) {
      const cleanup = docker(["rm", "--force", container], true);
      if (cleanup.status !== 0 || cleanup.error) {
        await writeFile(path.join(runDirectory, "cleanup-required.json"), `${JSON.stringify({ runId, container, cleanupRequired: true })}\n`, { flag: "w" });
        throw new Error(`${error instanceof Error ? error.message : String(error)}; cleanup failed and recovery state was preserved`);
      }
    }
    await rm(runDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function teardown(runId, runDirectory) {
  const container = `quorumx-e2e-${runId}`;
  const matches = docker(["ps", "--all", "--filter", `label=quorumx.e2e.run=${runId}`, "--format", "{{.Names}}"])
    .stdout.split(/\r?\n/).filter(Boolean);
  if (matches.some((name) => name !== container)) throw new Error("cleanup refused: run label resolved to an unexpected container");
  if (matches.includes(container)) docker(["rm", "--force", container]);
  await rm(runDirectory, { recursive: true, force: true });
}

function artifactRoot() {
  return path.resolve(process.env.QUORUMX_E2E_ARTIFACT_DIR || path.join(root, ".quorumx-e2e"));
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const runId = validateRunId(value(args, "--run-id") || (command === "provision" ? generatedRunId() : undefined));
  const result = await manifest(runId);
  const runDirectory = path.join(artifactRoot(), runId);
  if (command === "manifest") {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (command === "provision") {
    await mkdir(artifactRoot(), { recursive: true });
    await mkdir(runDirectory, { recursive: false });
    const provisioned = await provisionDatabase(runId, runDirectory, result);
    await writeFile(path.join(runDirectory, "manifest.redacted.json"), `${JSON.stringify(provisioned, null, 2)}\n`, { flag: "wx" });
    process.stdout.write(`${JSON.stringify(provisioned)}\n`);
    return;
  }
  if (command === "verify") {
    const state = JSON.parse(await readFile(path.join(runDirectory, "state.json"), "utf8"));
    const client = new Client({ connectionString: state.runtimeUrl });
    await client.connect();
    const verified = await client.query(`
      select current_user as runtime_role,
        count(distinct sources.id)::integer as sources,
        count(proposals.id)::integer as proposals,
        min(sources.display_name) as organization,
        has_table_privilege(current_user, 'quorumx.proposals', 'DELETE') as delete_privilege,
        has_schema_privilege(current_user, 'quorumx', 'CREATE') as schema_create_privilege,
        has_table_privilege(current_user, 'quorumx.assessments', 'UPDATE') as accepted_update_privilege,
        has_table_privilege(current_user, 'public.quorumx_schema_migrations', 'SELECT') as migration_read_privilege,
        (select not rolsuper and not rolcreatedb and not rolcreaterole and not rolinherit and not rolreplication and not rolbypassrls
          from pg_roles where rolname = current_user) as safe_role_attributes,
        (select count(*)::integer from pg_auth_members where member = (select oid from pg_roles where rolname = current_user)) as memberships
      from quorumx.sources sources
      left join quorumx.proposals proposals on proposals.source_id = sources.id
      where sources.configuration ->> 'runId' = $1
    `, [runId]);
    await client.end();
    const row = verified.rows[0];
    if (row.runtime_role !== "quorumx_runtime" || row.sources !== 1 || row.proposals !== 10
      || row.delete_privilege !== false || row.schema_create_privilege !== false
      || row.accepted_update_privilege !== false || row.migration_read_privilege !== false
      || row.safe_role_attributes !== true || row.memberships !== 0) {
      throw new Error("Velvet Solace database verification failed");
    }
    process.stdout.write(`${JSON.stringify({
      runId, organization: row.organization, sources: row.sources, proposals: row.proposals,
      runtimeRole: row.runtime_role, deletePrivilege: row.delete_privilege,
      schemaCreatePrivilege: row.schema_create_privilege,
      acceptedUpdatePrivilege: row.accepted_update_privilege,
      migrationReadPrivilege: row.migration_read_privilege,
      safeRoleAttributes: row.safe_role_attributes,
      memberships: row.memberships,
    })}\n`);
    return;
  }
  if (command === "teardown") {
    await teardown(runId, runDirectory);
    process.stdout.write(`${JSON.stringify({ runId, removed: true })}\n`);
    return;
  }
  if (command === "verify-clean") {
    const matches = docker(["ps", "--all", "--filter", `label=quorumx.e2e.run=${runId}`, "--format", "{{.Names}}"]).stdout.trim();
    const { access } = require("node:fs/promises");
    let directoryExists = true;
    try { await access(runDirectory); } catch { directoryExists = false; }
    if (matches || directoryExists) throw new Error("Velvet Solace cleanup could not be proven");
    process.stdout.write(`${JSON.stringify({ runId, clean: true })}\n`);
    return;
  }
  throw new Error("usage: velvet_solace.cjs <manifest|provision|verify|teardown|verify-clean> --run-id <id>");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
