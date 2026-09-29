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

export function normalizeSnapshotProposal(record: SnapshotRecord): SnapshotProposal {
  if (!record.id || !record.space?.id || typeof record.title !== "string" || typeof record.body !== "string") {
    throw new Error("Snapshot returned a malformed proposal");
  }
  const space = record.space.id.trim().toLowerCase();
  return {
    externalId: record.id,
    canonicalId: `snapshot:${space}:${record.id}`,
    source: { kind: "snapshot", space, proposalId: record.id },
    title: record.title,
    bodyText: record.body,
    choices: Array.isArray(record.choices) ? record.choices.filter((choice): choice is string => typeof choice === "string") : [],
    linkedEvidenceUrls: evidenceUrls(record.body),
    status: status(record.state),
    ...(iso(record.created) ? { submittedAt: iso(record.created) } : {}),
    ...(iso(record.start) ? { votingStartsAt: iso(record.start) } : {}),
    ...(iso(record.end) ? { votingEndsAt: iso(record.end) } : {}),
  };
}

export async function fetchRecentSnapshotProposals(
  space: string,
  fetcher: typeof fetch = fetch,
  limit = 20,
): Promise<SnapshotProposal[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 50));
  const query = `query Recent($spaces: [String!]!, $limit: Int!) {
    proposals(first: $limit, where: { space_in: $spaces }, orderBy: "created", orderDirection: desc) {
      id title body choices created start end state space { id }
    }
  }`;
  const url = new URL(SNAPSHOT_ENDPOINT);
  url.searchParams.set("query", query);
  url.searchParams.set("variables", JSON.stringify({ spaces: [space], limit: boundedLimit }));
  const response = await fetcher(url, {
    method: "GET",
    headers: { accept: "application/json", "user-agent": "QuorumX/0.2 (+https://quorumx.dev)" },
  });
  if (!response.ok) throw new Error(`Snapshot request failed with HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("Snapshot response exceeded the size limit");
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new Error("Snapshot response exceeded the size limit");
  const payload = JSON.parse(text) as SnapshotPayload;
  if (payload.errors?.length) {
    throw new Error(`Snapshot query failed: ${payload.errors.map((error) => error.message ?? "unknown error").join("; ")}`);
  }
  return (payload.data?.proposals ?? []).map(normalizeSnapshotProposal);
}
