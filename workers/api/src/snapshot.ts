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
  data?: { proposals?: SnapshotRecord[]; active?: SnapshotRecord[]; pending?: SnapshotRecord[] };
  errors?: Array<{ message?: string }>;
}

export interface SnapshotPage {
  proposals: SnapshotProposal[];
  first: number;
  skip: number;
  exhausted: boolean;
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
): Promise<SnapshotProposal[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 50));
  const query = `query Recent($spaces: [String!]!, $limit: Int!) {
    proposals(first: $limit, where: { space_in: $spaces }, orderBy: "created", orderDirection: desc) {
      id title body choices created start end state author space { id }
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
  const fetchedAt = new Date();
  return (payload.data?.proposals ?? []).map((proposal) => normalizeSnapshotProposal(proposal, fetchedAt));
}

async function fetchSnapshot(query: string, variables: Record<string, unknown>, fetcher: typeof fetch): Promise<{
  proposals: SnapshotProposal[]; counts: { proposals: number; active: number; pending: number };
}> {
  const url = new URL(SNAPSHOT_ENDPOINT);
  url.searchParams.set("query", query);
  url.searchParams.set("variables", JSON.stringify(variables));
  const response = await fetcher(url, {
    method: "GET",
    headers: { accept: "application/json", "user-agent": "QuorumX/0.3 (+https://quorumx.dev)" },
  });
  if (!response.ok) throw new Error(`Snapshot request failed with HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("Snapshot response exceeded the size limit");
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new Error("Snapshot response exceeded the size limit");
  const payload = JSON.parse(text) as SnapshotPayload;
  if (payload.errors?.length) throw new Error(`Snapshot query failed: ${payload.errors.map((error) => error.message ?? "unknown error").join("; ")}`);
  const fetchedAt = new Date();
  const records = [...(payload.data?.proposals ?? []), ...(payload.data?.active ?? []), ...(payload.data?.pending ?? [])];
  return {
    proposals: records.map((proposal) => normalizeSnapshotProposal(proposal, fetchedAt)),
    counts: {
      proposals: payload.data?.proposals?.length ?? 0,
      active: payload.data?.active?.length ?? 0,
      pending: payload.data?.pending?.length ?? 0,
    },
  };
}

export async function fetchOpenSnapshotProposalPage(
  space: string, skip: number, fetcher: typeof fetch = fetch, limit = 50,
): Promise<SnapshotPage> {
  const first = Math.max(1, Math.min(limit, 50));
  const boundedSkip = Number.isSafeInteger(skip) ? Math.max(0, Math.min(skip, 2_147_483_647)) : 0;
  const fields = "id title body choices created start end state author space { id }";
  const query = `query OpenPage($spaces: [String!]!, $first: Int!, $skip: Int!) {
    active: proposals(first: $first, skip: $skip, where: { space_in: $spaces, state: "active" }, orderBy: "created", orderDirection: desc) {
      ${fields}
    }
    pending: proposals(first: $first, skip: $skip, where: { space_in: $spaces, state: "pending" }, orderBy: "created", orderDirection: desc) {
      ${fields}
    }
  }`;
  const result = await fetchSnapshot(query, { spaces: [space], first, skip: boundedSkip }, fetcher);
  return { proposals: result.proposals, first, skip: boundedSkip,
    exhausted: result.counts.active < first && result.counts.pending < first };
}

export async function fetchSnapshotProposalsByIds(
  space: string, proposalIds: string[], fetcher: typeof fetch = fetch,
): Promise<SnapshotProposal[]> {
  const ids = [...new Set(proposalIds)].slice(0, 50);
  if (ids.length === 0) return [];
  const query = `query Reconcile($spaces: [String!]!, $ids: [String!]!) {
    proposals(first: 50, where: { space_in: $spaces, id_in: $ids }) {
      id title body choices created start end state author space { id }
    }
  }`;
  return (await fetchSnapshot(query, { spaces: [space], ids }, fetcher)).proposals;
}
