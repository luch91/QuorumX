import type { Client } from "pg";
import { getAssessment, getDueDiligence, getDueDiligenceV3, getProposal, listProposals, listSources } from "./api";
import { runIndexerCycle } from "./cycle";
import { withDatabase } from "./database";
import { createReassessmentJob } from "./database";
import { snapshotSourceForSpace } from "./sources";

const CONTRACT_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
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
  if (configuredVersion !== "1" && configuredVersion !== "2" && configuredVersion !== "3") {
    throw new Error("Assessment version is invalid");
  }
  if (configuredVersion === "2" && !CONTRACT_ADDRESS.test(env.QUORUMX_DUE_DILIGENCE_CONTRACT_ADDRESS)) {
    throw new Error("V2 contract address is invalid");
  }
  if (configuredVersion === "3" && !CONTRACT_ADDRESS.test(env.QUORUMX_DUE_DILIGENCE_V3_CONTRACT_ADDRESS)) {
    throw new Error("V3 contract address is invalid");
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
    assessmentVersion: configuredVersion as "1" | "2" | "3",
    assessmentSchemaVersion: configuredVersion === "3" ? "3.3" : configuredVersion,
    genlayer: {
      contractAddress: env.QUORUMX_CONTRACT_ADDRESS as `0x${string}`,
      ...(CONTRACT_ADDRESS.test(env.QUORUMX_DUE_DILIGENCE_CONTRACT_ADDRESS)
        ? { dueDiligenceContractAddress: env.QUORUMX_DUE_DILIGENCE_CONTRACT_ADDRESS as `0x${string}` }
        : {}),
      ...(CONTRACT_ADDRESS.test(env.QUORUMX_DUE_DILIGENCE_V3_CONTRACT_ADDRESS)
        ? { dueDiligenceV3ContractAddress: env.QUORUMX_DUE_DILIGENCE_V3_CONTRACT_ADDRESS as `0x${string}` }
        : {}),
      dueDiligenceContracts: {
        ...(CONTRACT_ADDRESS.test(env.QUORUMX_DUE_DILIGENCE_CONTRACT_ADDRESS)
          ? { "2": env.QUORUMX_DUE_DILIGENCE_CONTRACT_ADDRESS as `0x${string}` } : {}),
        ...(CONTRACT_ADDRESS.test(env.QUORUMX_DUE_DILIGENCE_V3_CONTRACT_ADDRESS)
          ? { "3.3": env.QUORUMX_DUE_DILIGENCE_V3_CONTRACT_ADDRESS as `0x${string}` } : {}),
      },
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

async function health(env: Env): Promise<Response> {
  try {
    const state = await withDatabase(env.HYPERDRIVE.connectionString, async (client) => {
      const result = await client.query<{
        database_name: string; checked_at: string; sources: number; proposals: number;
        pending_jobs: number; submitted_jobs: number; last_success: string | null;
      }>(`
        select
          current_database() as database_name,
          now()::text as checked_at,
          (select count(*)::integer from quorumx.sources where enabled) as sources,
          (select count(*)::integer from quorumx.proposals) as proposals,
          (select count(*)::integer from quorumx.assessment_jobs where status in ('pending', 'retryable', 'processing')) as pending_jobs,
          (select count(*)::integer from quorumx.assessment_jobs where status = 'submitted') as submitted_jobs,
          (select max(last_succeeded_at)::text from quorumx.sources where enabled) as last_success
      `);
      return result.rows[0];
    });
    return json({
      status: "ok",
      database: state.database_name,
      checkedAt: state.checked_at,
      indexer: {
        enabledSources: state.sources,
        proposals: state.proposals,
        pendingJobs: state.pending_jobs,
        submittedJobs: state.submitted_jobs,
        lastSuccessfulPollAt: state.last_success,
      },
    });
  } catch (error) {
    console.error(JSON.stringify({ message: "health check failed", error: message(error) }));
    return json({ status: "degraded", database: "unavailable" }, { status: 503 });
  }
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
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
    return json({ service: "quorumx-api", version: "0.3.0", status: "online" });
  }
  if (url.pathname === "/health" && request.method === "GET") return health(env);
  if (url.pathname === "/internal/run" && request.method === "POST") {
    const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!await secureEqual(provided, env.QUORUMX_ADMIN_TOKEN)) {
      return json({ error: "unauthorized" }, { status: 401 });
    }
    const result = await runIndexerCycle(cycleSettings(env));
    console.log(JSON.stringify({ message: "manual indexer cycle completed", ...result }));
    return json(result, { status: result.errors.length ? 207 : 200 });
  }
  if (url.pathname === "/internal/reassess" && request.method === "POST") {
    const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!await secureEqual(provided, env.QUORUMX_ADMIN_TOKEN)) return json({ error: "unauthorized" }, { status: 401 });
    const body = await request.json() as { canonicalId?: unknown; assessmentRunId?: unknown };
    if (typeof body.canonicalId !== "string" || !body.canonicalId.trim()) return json({ error: "invalid_canonical_id" }, { status: 400 });
    const canonicalId = body.canonicalId;
    const runId = typeof body.assessmentRunId === "string" ? body.assessmentRunId : `manual:3.3:${crypto.randomUUID()}`;
    const jobId = await withDatabase(env.HYPERDRIVE.connectionString,
      (client) => createReassessmentJob(client, canonicalId, "3.3", runId));
    return jobId ? json({ jobId, assessmentRunId: runId }, { status: 202 })
      : json({ error: "proposal_not_found_or_duplicate_run" }, { status: 409 });
  }
  if (request.method !== "GET") {
    return json({ error: "method_not_allowed" }, { status: 405, headers: { allow: "GET" } });
  }
  try {
    return await withDatabase(env.HYPERDRIVE.connectionString, async (client: Client) => {
      if (url.pathname === "/v1/sources") return json(await listSources(client));
      if (url.pathname === "/v1/proposals") return json(await listProposals(client, url));
      if (url.pathname.startsWith("/v1/proposals/")) {
        const canonicalId = pathValue(url.pathname.slice("/v1/proposals/".length));
        const proposal = await getProposal(client, canonicalId);
        return proposal ? json({ data: proposal }) : json({ error: "not_found" }, { status: 404 });
      }
      if (url.pathname.startsWith("/v1/assessments/")) {
        const proposalKey = pathValue(url.pathname.slice("/v1/assessments/".length));
        const assessment = await getAssessment(client, proposalKey);
        return assessment ? json({ data: assessment }) : json({ error: "not_found" }, { status: 404 });
      }
      if (url.pathname.startsWith("/v2/proposals/") && url.pathname.endsWith("/due-diligence")) {
        const canonicalId = pathValue(url.pathname.slice("/v2/proposals/".length, -"/due-diligence".length));
        const assessment = await getDueDiligence(client, canonicalId);
        return assessment ? json({ data: assessment }) : json({ error: "not_found" }, { status: 404 });
      }
      if (url.pathname.startsWith("/v3/proposals/") && url.pathname.endsWith("/due-diligence")) {
        const canonicalId = pathValue(url.pathname.slice("/v3/proposals/".length, -"/due-diligence".length));
        const assessment = await getDueDiligenceV3(client, canonicalId, url.searchParams.get("schema") ?? undefined);
        return assessment ? json({ data: assessment }) : json({ error: "not_found" }, { status: 404 });
      }
      return json({ error: "not_found" }, { status: 404 });
    });
  } catch (error) {
    if (error instanceof RangeError) return json({ error: error.message }, { status: 400 });
    throw error;
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      console.error(JSON.stringify({ message: "request failed", path: new URL(request.url).pathname, error: message(error) }));
      return json({ error: "internal_error" }, { status: 500 });
    }
  },
  async scheduled(controller, env): Promise<void> {
    try {
      const result = await runIndexerCycle({ ...cycleSettings(env), workerId: `cron:${controller.scheduledTime}` });
      console.log(JSON.stringify({ message: "scheduled indexer cycle completed", ...result }));
    } catch (error) {
      console.error(JSON.stringify({ message: "scheduled indexer cycle failed", error: message(error) }));
      throw error;
    }
  },
} satisfies ExportedHandler<Env>;
