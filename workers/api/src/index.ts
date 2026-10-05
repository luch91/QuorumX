import type { Client } from "pg";
import { getAssessment, getDueDiligence, getProposal, listProposals, listSources } from "./api";
import { runIndexerCycle } from "./cycle";
import { withDatabase } from "./database";
import { snapshotSourceForSpace } from "./sources";
import { cycleOutcome } from "./operational";

const CONTRACT_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;
const SERVICE_VERSION = "0.4.0";

function json(body: unknown, init: ResponseInit = {}, cache = "no-store", correlationId?: string): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", cache);
  if (correlationId) headers.set("x-correlation-id", correlationId);
  headers.set("access-control-allow-origin", "*");
  return new Response(JSON.stringify(body), { ...init, headers });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pathValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new RangeError("invalid_path");
  }
}

function cycleSettings(env: Env) {
  const configuredVersion: string = env.QUORUMX_ASSESSMENT_VERSION;
  if (!CONTRACT_ADDRESS.test(env.QUORUMX_CONTRACT_ADDRESS)) throw new Error("Contract address is invalid");
  if (configuredVersion !== "1" && configuredVersion !== "2") {
    throw new Error("Assessment version is invalid");
  }
  if (configuredVersion === "2" && !CONTRACT_ADDRESS.test(env.QUORUMX_DUE_DILIGENCE_CONTRACT_ADDRESS)) {
    throw new Error("V2 contract address is invalid");
  }
  if (!PRIVATE_KEY.test(env.QUORUMX_GENLAYER_PRIVATE_KEY)) throw new Error("GenLayer signing key is invalid");
  const snapshotLimit = Number(env.QUORUMX_SNAPSHOT_LIMIT);
  if (!Number.isInteger(snapshotLimit) || snapshotLimit < 1 || snapshotLimit > 50) {
    throw new Error("Snapshot limit must be an integer from 1 to 50");
  }
  const snapshotSpaces = [...new Set(
    env.QUORUMX_SNAPSHOT_SPACES.split(",").map((space) => space.trim().toLowerCase()).filter(Boolean),
  )];
  if (snapshotSpaces.length === 0) throw new Error("At least one Snapshot space is required");
  snapshotSpaces.forEach(snapshotSourceForSpace);
  return {
    databaseUrl: env.HYPERDRIVE.connectionString,
    snapshotSpaces,
    snapshotLimit,
    enableWrites: env.QUORUMX_ENABLE_WRITES === "true",
    assessmentVersion: configuredVersion as "1" | "2",
    genlayer: {
      contractAddress: env.QUORUMX_CONTRACT_ADDRESS as `0x${string}`,
      ...(CONTRACT_ADDRESS.test(env.QUORUMX_DUE_DILIGENCE_CONTRACT_ADDRESS)
        ? { dueDiligenceContractAddress: env.QUORUMX_DUE_DILIGENCE_CONTRACT_ADDRESS as `0x${string}` }
        : {}),
      privateKey: env.QUORUMX_GENLAYER_PRIVATE_KEY as `0x${string}`,
      ...(env.QUORUMX_GENLAYER_RPC_URL ? { rpcUrl: env.QUORUMX_GENLAYER_RPC_URL } : {}),
    },
  };
}

async function secureEqual(provided: string, expected: string): Promise<boolean> {
  const encoded = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoded.encode(provided)),
    crypto.subtle.digest("SHA-256", encoded.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(providedHash, expectedHash);
}

async function readiness(env: Env, correlationId: string): Promise<Response> {
  try {
    const state = await withDatabase(env.HYPERDRIVE.connectionString, async (client) => {
      const result = await client.query<{
        database_name: string; checked_at: string; sources: number; proposals: number;
        pending_jobs: number; submitted_jobs: number; dead_letter_jobs: number; oldest_queue_at: string | null;
        last_success: string | null; migration: string | null; stale_sources: number; old_transactions: number;
      }>(`
        select
          current_database() as database_name,
          now()::text as checked_at,
          (select count(*)::integer from quorumx.sources where enabled) as sources,
          (select count(*)::integer from quorumx.proposals) as proposals,
          (select count(*)::integer from quorumx.assessment_jobs where status in ('pending', 'retryable', 'processing')) as pending_jobs,
          (select count(*)::integer from quorumx.assessment_jobs where status = 'submitted') as submitted_jobs,
          (select count(*)::integer from quorumx.assessment_jobs where status = 'dead_letter') as dead_letter_jobs,
          (select min(created_at)::text from quorumx.assessment_jobs where status in ('pending','retryable','processing','submitted')) as oldest_queue_at,
          (select max(last_succeeded_at)::text from quorumx.sources where enabled) as last_success,
          (select count(*)::integer from quorumx.sources where enabled and
            (last_succeeded_at is null or last_succeeded_at < now() - make_interval(secs => greatest(poll_interval_seconds * 3, 900)))) as stale_sources,
          (select count(*)::integer from quorumx.transactions where state = 'submitted' and submitted_at < now() - interval '1 hour') as old_transactions,
          case when to_regclass('quorumx.submission_intents') is not null
            then '0010_runtime_privilege_matrix.sql' else null end as migration
      `);
      return result.rows[0];
    });
    const status = state.migration === null ? "unready"
      : state.stale_sources > 0 || state.dead_letter_jobs > 0 || state.old_transactions > 0 ? "degraded" : "ok";
    return json({
      status,
      database: state.database_name,
      checkedAt: state.checked_at,
      indexer: {
        enabledSources: state.sources,
        proposals: state.proposals,
        pendingJobs: state.pending_jobs,
        submittedJobs: state.submitted_jobs,
        deadLetterAndQuarantineCount: state.dead_letter_jobs,
        staleSources: state.stale_sources,
        oldPendingTransactions: state.old_transactions,
        oldestQueuedAt: state.oldest_queue_at,
        lastSuccessfulPollAt: state.last_success,
      },
      attestation: { serviceVersion: SERVICE_VERSION, releaseCommit: env.QUORUMX_RELEASE_COMMIT,
        assessmentVersion: env.QUORUMX_ASSESSMENT_VERSION, writesEnabled: env.QUORUMX_ENABLE_WRITES === "true",
        schemaMigration: state.migration, contractAddress: env.QUORUMX_ASSESSMENT_VERSION === "2"
          ? env.QUORUMX_DUE_DILIGENCE_CONTRACT_ADDRESS : env.QUORUMX_CONTRACT_ADDRESS },
      correlationId,
    }, { status: status === "unready" ? 503 : 200 }, "no-store", correlationId);
  } catch (error) {
    console.error(JSON.stringify({ message: "health check failed", error: message(error) }));
    return json({ status: "unready", dependency: "database", correlationId }, { status: 503 }, "no-store", correlationId);
  }
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const correlationId = request.headers.get("x-correlation-id")?.slice(0, 128) || crypto.randomUUID();
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "authorization, content-type",
        "access-control-max-age": "86400",
      },
    });
  }
  if (url.pathname === "/" && request.method === "GET") {
    return json({ service: "quorumx-api", version: SERVICE_VERSION, status: "online" });
  }
  if (url.pathname === "/health/live" && request.method === "GET") {
    return json({ status: "ok", service: "quorumx-api", version: SERVICE_VERSION, correlationId }, {}, "no-store", correlationId);
  }
  if ((url.pathname === "/health" || url.pathname === "/health/ready") && request.method === "GET") return readiness(env, correlationId);
  if (url.pathname === "/internal/run" && request.method === "POST") {
    const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!await secureEqual(provided, env.QUORUMX_ADMIN_TOKEN)) {
      return json({ error: "unauthorized", correlationId }, { status: 401 }, "no-store", correlationId);
    }
    const result = await runIndexerCycle(cycleSettings(env));
    const outcome = cycleOutcome(result, cycleSettings(env).snapshotSpaces.length);
    console.log(JSON.stringify({ message: "manual indexer cycle completed", ...result }));
    return json({ ...result, outcome }, { status: outcome === "healthy" ? 200 : outcome === "degraded" ? 207 : 503 }, "no-store", correlationId);
  }
  if (request.method !== "GET") {
    return json({ error: "method_not_allowed", correlationId }, { status: 405, headers: { allow: "GET" } }, "no-store", correlationId);
  }
  try {
    return await withDatabase(env.HYPERDRIVE.connectionString, async (client: Client) => {
      const publicCache = "public, max-age=15, stale-while-revalidate=30";
      if (url.pathname === "/v1/sources") return json(await listSources(client), {}, publicCache, correlationId);
      if (url.pathname === "/v1/proposals") return json(await listProposals(client, url), {}, publicCache, correlationId);
      if (url.pathname.startsWith("/v1/proposals/")) {
        const canonicalId = pathValue(url.pathname.slice("/v1/proposals/".length));
        const proposal = await getProposal(client, canonicalId);
        return proposal ? json({ data: proposal }, {}, publicCache, correlationId) : json({ error: "not_found", correlationId }, { status: 404 }, "no-store", correlationId);
      }
      if (url.pathname.startsWith("/v1/assessments/")) {
        const proposalKey = pathValue(url.pathname.slice("/v1/assessments/".length));
        const assessment = await getAssessment(client, proposalKey);
        return assessment ? json({ data: assessment }, {}, publicCache, correlationId) : json({ error: "not_found", correlationId }, { status: 404 }, "no-store", correlationId);
      }
      if (url.pathname.startsWith("/v2/proposals/") && url.pathname.endsWith("/due-diligence")) {
        const canonicalId = pathValue(url.pathname.slice("/v2/proposals/".length, -"/due-diligence".length));
        const assessment = await getDueDiligence(client, canonicalId);
        return assessment ? json({ data: assessment }, {}, publicCache, correlationId) : json({ error: "not_found", correlationId }, { status: 404 }, "no-store", correlationId);
      }
      return json({ error: "not_found", correlationId }, { status: 404 }, "no-store", correlationId);
    });
  } catch (error) {
    if (error instanceof RangeError) return json({ error: error.message, correlationId }, { status: 400 }, "no-store", correlationId);
    throw error;
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      const correlationId = request.headers.get("x-correlation-id")?.slice(0, 128) || crypto.randomUUID();
      console.error(JSON.stringify({ message: "request failed", correlationId, path: new URL(request.url).pathname, error: message(error) }));
      return json({ error: "internal_error", correlationId }, { status: 500 }, "no-store", correlationId);
    }
  },
  async scheduled(controller, env): Promise<void> {
    try {
      const result = await runIndexerCycle({ ...cycleSettings(env), workerId: `cron:${controller.scheduledTime}` });
      const outcome = cycleOutcome(result, cycleSettings(env).snapshotSpaces.length);
      const detail = { message: `scheduled indexer cycle ${outcome}`, outcome, ...result };
      if (outcome === "failed") throw new Error(JSON.stringify(detail));
      if (outcome === "degraded") console.warn(JSON.stringify(detail));
      else console.log(JSON.stringify(detail));
    } catch (error) {
      console.error(JSON.stringify({ message: "scheduled indexer cycle failed", error: message(error) }));
      throw error;
    }
  },
} satisfies ExportedHandler<Env>;
