export interface SentinelConfig {
  escalationThreshold: number;
  minimumRemainingVoteMinutes: number;
  pollIntervalMs: number;
  maxCompletedRequests: number;
  maxBudgetUsd: number;
  maxRequestCostUsd: number;
}

export interface ProposalSourceConfig {
  snapshotSpaces: string[];
  allowFixtures: boolean;
}

function readNumber(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${key} must be a number between ${min} and ${max}.`);
  }
  return value;
}

/** Defaults favor a conservative review window and avoid fast polling. */
export function loadSentinelConfig(env: NodeJS.ProcessEnv = process.env): SentinelConfig {
  return {
    escalationThreshold: readNumber(env, "SENTINEL_ESCALATION_THRESHOLD", 0.85, 0.5, 1),
    minimumRemainingVoteMinutes: readNumber(env, "SENTINEL_MIN_REMAINING_VOTE_MINUTES", 60, 0, 10_080),
    pollIntervalMs: readNumber(env, "SENTINEL_POLL_INTERVAL_MS", 900_000, 60_000, 86_400_000),
    maxCompletedRequests: readNumber(env, "SENTINEL_MAX_REQUESTS", 100, 1, 1_000_000),
    maxBudgetUsd: readNumber(env, "SENTINEL_MAX_BUDGET_USD", 1, 0.01, 1_000_000),
    maxRequestCostUsd: readNumber(env, "SENTINEL_MAX_REQUEST_COST_USD", 0.01, 0.000001, 1_000_000),
  };
}

export function loadProposalSourceConfig(env: NodeJS.ProcessEnv = process.env): ProposalSourceConfig {
  const rawSpaces = env.QUORUMX_SNAPSHOT_SPACES;
  const snapshotSpaces = rawSpaces === undefined
    ? ["balancer.eth"]
    : [...new Set(rawSpaces.split(",").map((space) => space.trim().toLowerCase()).filter(Boolean))];
  if (snapshotSpaces.length === 0) {
    throw new Error("QUORUMX_SNAPSHOT_SPACES must include at least one Snapshot space.");
  }

  const rawFixtures = env.QUORUMX_ALLOW_FIXTURES;
  if (rawFixtures !== undefined && rawFixtures !== "true" && rawFixtures !== "false") {
    throw new Error("QUORUMX_ALLOW_FIXTURES must be true or false.");
  }

  return {
    snapshotSpaces,
    allowFixtures: rawFixtures === "true",
  };
}

export interface GenLayerConfig {
  network: "localnet" | "studionet" | "testnetAsimov" | "testnetBradbury";
  rpcUrl?: string;
  contractAddress: `0x${string}`;
  privateKey?: `0x${string}`;
}

export function loadGenLayerConfig(env: NodeJS.ProcessEnv = process.env): GenLayerConfig {
  const network = env.QUORUMX_GENLAYER_NETWORK ?? "localnet";
  if (!["localnet", "studionet", "testnetAsimov", "testnetBradbury"].includes(network)) {
    throw new Error("QUORUMX_GENLAYER_NETWORK is invalid.");
  }
  const contractAddress = env.QUORUMX_CONTRACT_ADDRESS;
  if (!contractAddress || !/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) {
    throw new Error("QUORUMX_CONTRACT_ADDRESS must be a 20-byte hex address.");
  }
  const rpcUrl = env.QUORUMX_GENLAYER_RPC_URL;
  if (rpcUrl && !["http:", "https:"].includes(new URL(rpcUrl).protocol)) {
    throw new Error("QUORUMX_GENLAYER_RPC_URL must be HTTP or HTTPS.");
  }
  const privateKey = env.QUORUMX_GENLAYER_PRIVATE_KEY;
  if (privateKey && !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("QUORUMX_GENLAYER_PRIVATE_KEY must be a 32-byte hex key.");
  }
  return {
    network: network as GenLayerConfig["network"],
    contractAddress: contractAddress as `0x${string}`,
    ...(rpcUrl ? { rpcUrl } : {}),
    ...(privateKey ? { privateKey: privateKey as `0x${string}` } : {}),
  };
}
