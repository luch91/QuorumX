export interface ProposalSourceConfig {
  snapshotSpaces: string[];
  allowFixtures: boolean;
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

export const STUDIONET_GOVERNANCE_RISK_ORACLE = "0x59A6A393e15B43b6a13ac6B31A3fbb19094Bf237" as const;

export function loadGenLayerConfig(env: NodeJS.ProcessEnv = process.env): GenLayerConfig {
  const network = env.QUORUMX_GENLAYER_NETWORK ?? "studionet";
  if (!["localnet", "studionet", "testnetAsimov", "testnetBradbury"].includes(network)) {
    throw new Error("QUORUMX_GENLAYER_NETWORK is invalid.");
  }
  const contractAddress = env.QUORUMX_CONTRACT_ADDRESS
    ?? (network === "studionet" ? STUDIONET_GOVERNANCE_RISK_ORACLE : undefined);
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

export function loadGenLayerReadConfig(env: NodeJS.ProcessEnv = process.env): GenLayerConfig {
  const readOnlyEnv = { ...env };
  delete readOnlyEnv.QUORUMX_GENLAYER_PRIVATE_KEY;
  return loadGenLayerConfig(readOnlyEnv);
}
