import { canonicalProposalId, type GovernanceProposal, type GovernanceProposalStatus, type ProposalSource } from "../../domain/governance_proposal";
import { ProposalSourceError, type ProposalSourceAdapter } from "../proposal_source";

const SNAPSHOT_HUB_URL = "https://hub.snapshot.org/graphql";

interface SnapshotRecord {
  id: string; title: string; body: string; choices?: string[]; created: number; start?: number; end: number;
  state?: string; space: { id: string };
}

interface SnapshotPayload {
  data?: { proposals?: SnapshotRecord[]; proposal?: SnapshotRecord | null };
  errors?: Array<{ message: string }>;
}

function evidenceUrls(body: string): string[] {
  return [...new Set(body.match(/https?:\/\/[^\s)<>'"`]+/g) ?? [])];
}

function status(value?: string): GovernanceProposalStatus {
  return value === "pending" || value === "active" || value === "closed" ? value : "unknown";
}

function normalize(record: SnapshotRecord): GovernanceProposal {
  const source: ProposalSource = { kind: "snapshot", space: record.space.id, proposalId: record.id };
  return {
    canonicalId: canonicalProposalId(source), source, title: record.title, bodyText: record.body,
    choices: record.choices ?? [], linkedEvidenceUrls: evidenceUrls(record.body),
    submittedAt: new Date(record.created * 1_000).toISOString(),
    votingStartsAt: record.start === undefined ? undefined : new Date(record.start * 1_000).toISOString(),
    votingEndsAt: new Date(record.end * 1_000).toISOString(), status: status(record.state),
  };
}

export class SnapshotProposalSource implements ProposalSourceAdapter {
  readonly kind = "snapshot" as const;

  constructor(
    private readonly spaces: string[],
    private readonly fetcher: typeof fetch = fetch,
    private readonly endpoint = SNAPSHOT_HUB_URL,
  ) {}

  async listEligible(): Promise<GovernanceProposal[]> {
    const payload = await this.query({
      query: "query Active($spaces: [String!]!) { proposals(first: 20, where: { space_in: $spaces, state: \"active\" }) { id title body choices created start end state space { id } } }",
      variables: { spaces: this.spaces },
    });
    return (payload.data?.proposals ?? []).map(normalize);
  }

  async get(reference: ProposalSource): Promise<GovernanceProposal> {
    if (reference.kind !== "snapshot") throw new ProposalSourceError("Snapshot source requires a Snapshot reference", "invalid_reference");
    const payload = await this.query({
      query: "query Proposal($id: String!) { proposal(id: $id) { id title body choices created start end state space { id } } }",
      variables: { id: reference.proposalId },
    });
    const record = payload.data?.proposal;
    if (!record || record.space.id !== reference.space) throw new ProposalSourceError("Snapshot proposal was not found", "not_found");
    return normalize(record);
  }

  private async query(body: object): Promise<SnapshotPayload> {
    const response = await this.fetcher(this.endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!response.ok) throw new ProposalSourceError(`Snapshot request failed: HTTP ${response.status}`, "unavailable");
    const payload = await response.json() as SnapshotPayload;
    if (payload.errors?.length) throw new ProposalSourceError(`Snapshot query failed: ${payload.errors.map((e) => e.message).join("; ")}`, "invalid_response");
    return payload;
  }
}
