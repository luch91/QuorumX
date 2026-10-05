import type { ProposalStatus, SnapshotProposal } from "./domain";

const SNAPSHOT_ENDPOINT = "https://hub.snapshot.org/graphql";
const MAX_RESPONSE_BYTES = 2_000_000;

interface SnapshotRecord {
  id: string;
  title: string;
  body: string;
  choices?: string[];
  created?: number;
  start?: number;
  end?: number;
  state?: string;
  author: string;
  space: { id: string };
}

interface SnapshotPayload {
  data?: { proposals?: SnapshotRecord[] };
  errors?: Array<{ message?: string }>;
}

function status(value?: string): ProposalStatus {
  return value === "pending" || value === "active" || value === "closed" ? value : "unknown";
}

function iso(seconds?: number): string | undefined {
  return seconds === undefined ? undefined : new Date(seconds * 1_000).toISOString();
}

function evidenceUrls(body: string): string[] {
  return [...new Set(body.match(/https?:\/\/[^\s)<>'"`]+/g) ?? [])].slice(0, 100);
}

async function boundedResponseText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel("response size limit exceeded");
        throw new Error("Snapshot response exceeded the size limit");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export function normalizeSnapshotProposal(record: SnapshotRecord, now = new Date()): SnapshotProposal {
  if (!record.id || !record.space?.id || typeof record.title !== "string" || typeof record.body !== "string"
    || !/^0x[0-9a-fA-F]{40}$/.test(record.author)) {
    throw new Error("Snapshot returned a malformed proposal");
  }
  const space = record.space.id.trim().toLowerCase();
  const proposalStatus = status(record.state);
  const votingEndsAt = iso(record.end);
  return {
    externalId: record.id,
    canonicalId: `snapshot:${space}:${record.id}`,
    source: { kind: "snapshot", space, proposalId: record.id },
    authorAddress: record.author.toLowerCase() as `0x${string}`,
    canonicalUrl: `https://snapshot.box/#/s:${encodeURIComponent(space)}/proposal/${encodeURIComponent(record.id)}`,
    title: record.title,
    bodyText: record.body,
    choices: Array.isArray(record.choices) ? record.choices.filter((choice): choice is string => typeof choice === "string") : [],
    linkedEvidenceUrls: evidenceUrls(record.body),
    status: proposalStatus,
    ...(iso(record.created) ? { submittedAt: iso(record.created) } : {}),
    ...(iso(record.start) ? { votingStartsAt: iso(record.start) } : {}),
    ...(votingEndsAt ? { votingEndsAt } : {}),
    assessmentEligible: (proposalStatus === "active" || proposalStatus === "pending")
      && (votingEndsAt === undefined || new Date(votingEndsAt).getTime() > now.getTime()),
  };
}

export async function fetchRecentSnapshotProposals(
  space: string,
  fetcher: typeof fetch = fetch,
  limit = 20,
  timeoutMs = 10_000,
  offset = 0,
): Promise<SnapshotProposal[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 50));
  const query = `query Recent($spaces: [String!]!, $limit: Int!, $skip: Int!) {
    proposals(first: $limit, skip: $skip, where: { space_in: $spaces }, orderBy: "created", orderDirection: desc) {
      id title body choices created start end state author space { id }
    }
  }`;
  const url = new URL(SNAPSHOT_ENDPOINT);
  url.searchParams.set("query", query);
  url.searchParams.set("variables", JSON.stringify({ spaces: [space], limit: boundedLimit, skip: Math.max(0, offset) }));
  const response = await fetcher(url, {
    method: "GET",
    headers: { accept: "application/json", "user-agent": "QuorumX/0.2 (+https://quorumx.dev)" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Snapshot request failed with HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("Snapshot response exceeded the size limit");
  const text = await boundedResponseText(response);
  const payload = JSON.parse(text) as SnapshotPayload;
  if (payload.errors?.length) {
    throw new Error(`Snapshot query failed: ${payload.errors.map((error) => error.message ?? "unknown error").join("; ")}`);
  }
  const fetchedAt = new Date();
  return (payload.data?.proposals ?? []).map((proposal) => normalizeSnapshotProposal(proposal, fetchedAt));
}
