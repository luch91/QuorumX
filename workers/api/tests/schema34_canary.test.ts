jest.mock("../src/database", () => ({
  createIsolatedSchema34CanaryJob: jest.fn(),
  createReassessmentJob: jest.fn(),
  withDatabase: jest.fn(async (_url: string, task: (client: object) => Promise<unknown>) => task({})),
  getBackfillRun: jest.fn(),
  setBackfillRunStatus: jest.fn(),
  startBackfillRun: jest.fn(),
}));
jest.mock("../src/cycle", () => ({
  runIndexerCycle: jest.fn(),
  runIsolatedSchema34Canary: jest.fn(),
}));

import worker, { cycleSettings } from "../src/index";
import { runIndexerCycle, runIsolatedSchema34Canary } from "../src/cycle";
import { createIsolatedSchema34CanaryJob } from "../src/database";
import { SCHEMA34_CANARY_BIP933 } from "../src/schema34_canary";

const token = "a".repeat(32);
const runId = "schema34-canary:bip933:e70e0a83";

function environment(overrides: Record<string, unknown> = {}): Env {
  return {
    HYPERDRIVE: { connectionString: "postgresql://runtime.invalid/quorumx" },
    QUORUMX_SNAPSHOT_SPACES: "balancer.eth,safe.eth,arbitrumfoundation.eth,ens.eth",
    QUORUMX_SNAPSHOT_LIMIT: "20",
    QUORUMX_ENABLE_WRITES: "true",
    QUORUMX_GENLAYER_NETWORK: "studionet",
    QUORUMX_GENLAYER_RPC_URL: "https://studio.genlayer.com/api",
    QUORUMX_CONTRACT_ADDRESS: "0x1111111111111111111111111111111111111111",
    QUORUMX_DUE_DILIGENCE_CONTRACT_ADDRESS: "0x2222222222222222222222222222222222222222",
    QUORUMX_DUE_DILIGENCE_V3_CONTRACT_ADDRESS: "0x3333333333333333333333333333333333333333",
    QUORUMX_DUE_DILIGENCE_V3_4_CONTRACT_ADDRESS: "",
    QUORUMX_SCHEMA34_CANARY_RUN_ID: "",
    QUORUMX_ASSESSMENT_VERSION: "3",
    QUORUMX_ASSESSMENT_SCHEMA_VERSION: "3.3",
    QUORUMX_RELEASE_COMMIT: "test",
    QUORUMX_ADMIN_TOKEN: token,
    QUORUMX_GENLAYER_PRIVATE_KEY: `0x${"4".repeat(64)}`,
    ...overrides,
  } as unknown as Env;
}

function request(path: string, body: Record<string, unknown>, authorized = true): Request {
  return new Request(`https://api.example${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(authorized ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

describe("schema-3.4 isolated canary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(runIndexerCycle).mockResolvedValue({ sourcesPolled: 4, proposalsSeen: 0, revisionsCreated: 0, jobsCreated: 0,
      transactionsRecovered: 0, jobsProcessed: 0, errors: [] });
    jest.mocked(runIsolatedSchema34Canary).mockResolvedValue({ sourcesPolled: 0, proposalsSeen: 0, revisionsCreated: 0,
      jobsCreated: 0, transactionsRecovered: 0, jobsProcessed: 1, errors: [] });
  });

  it("keeps ordinary ingestion pinned to schema 3.3", () => {
    expect(cycleSettings(environment()).assessmentSchemaVersion).toBe("3.3");
    expect(() => cycleSettings(environment({ QUORUMX_ASSESSMENT_SCHEMA_VERSION: "3.4" }))).toThrow("ordinary ingestion must use schema 3.3");
  });

  it("requires authentication and the configured proposal/run allowlist", async () => {
    const configured = environment({ QUORUMX_DUE_DILIGENCE_V3_4_CONTRACT_ADDRESS: "0x4444444444444444444444444444444444444444",
      QUORUMX_SCHEMA34_CANARY_RUN_ID: runId });
    expect((await worker.fetch(request("/internal/schema34-canary", { canonicalId: SCHEMA34_CANARY_BIP933, assessmentRunId: runId }, false), configured)).status).toBe(401);
    expect((await worker.fetch(request("/internal/schema34-canary", { canonicalId: "snapshot:balancer.eth:other", assessmentRunId: runId }), configured)).status).toBe(400);
    expect((await worker.fetch(request("/internal/schema34-canary", { canonicalId: SCHEMA34_CANARY_BIP933, assessmentRunId: "different" }), configured)).status).toBe(400);
    expect(createIsolatedSchema34CanaryJob).not.toHaveBeenCalled();
  });

  it("enqueues only the designated unique canary job and rejects a duplicate", async () => {
    const configured = environment({ QUORUMX_DUE_DILIGENCE_V3_4_CONTRACT_ADDRESS: "0x4444444444444444444444444444444444444444",
      QUORUMX_SCHEMA34_CANARY_RUN_ID: runId });
    jest.mocked(createIsolatedSchema34CanaryJob).mockResolvedValueOnce("1701").mockResolvedValueOnce(undefined);
    const first = await worker.fetch(request("/internal/schema34-canary", { canonicalId: SCHEMA34_CANARY_BIP933, assessmentRunId: runId }), configured);
    expect(first.status).toBe(202);
    expect(createIsolatedSchema34CanaryJob).toHaveBeenCalledWith(expect.anything(), SCHEMA34_CANARY_BIP933, runId);
    const duplicate = await worker.fetch(request("/internal/schema34-canary", { canonicalId: SCHEMA34_CANARY_BIP933, assessmentRunId: runId }), configured);
    expect(duplicate.status).toBe(409);
  });

  it("runs only the configured persisted canary and never invokes normal ingestion", async () => {
    const configured = environment({ QUORUMX_DUE_DILIGENCE_V3_4_CONTRACT_ADDRESS: "0x4444444444444444444444444444444444444444",
      QUORUMX_SCHEMA34_CANARY_RUN_ID: runId });
    const response = await worker.fetch(request("/internal/schema34-canary/run", { canonicalId: SCHEMA34_CANARY_BIP933, assessmentRunId: runId }), configured);
    expect(response.status).toBe(200);
    expect(runIsolatedSchema34Canary).toHaveBeenCalledWith(expect.objectContaining({ assessmentSchemaVersion: "3.4" }),
      { canonicalId: SCHEMA34_CANARY_BIP933, assessmentRunId: runId });
    expect(runIndexerCycle).not.toHaveBeenCalled();
    expect(createIsolatedSchema34CanaryJob).not.toHaveBeenCalled();
  });

  it("keeps the ordinary authenticated cycle on schema 3.3", async () => {
    const response = await worker.fetch(request("/internal/run", {}), environment());
    expect(response.status).toBe(200);
    expect(runIndexerCycle).toHaveBeenCalledWith(expect.objectContaining({ assessmentSchemaVersion: "3.3" }));
    expect(runIsolatedSchema34Canary).not.toHaveBeenCalled();
  });
});
