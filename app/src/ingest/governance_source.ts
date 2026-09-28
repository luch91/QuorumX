/** Compatibility entry point for the legacy Balancer Snapshot workflow. */

import {
  canonicalProposalId,
  type GovernanceProposal,
  type ProposalSource,
} from "../domain/governance_proposal";

export type { GovernanceProposal } from "../domain/governance_proposal";

export const SNAPSHOT_HUB_URL = "https://hub.snapshot.org/graphql";
export const SNAPSHOT_SPACE = "balancer.eth";

interface SnapshotProposal {
  id: string;
  title: string;
  body: string;
  created: number;
  end: number;
  state?: string;
  choices?: string[];
  space: {
    id: string;
    name: string;
  };
}

interface SnapshotResponse {
  data?: {
    proposals?: SnapshotProposal[];
  };
  errors?: Array<{
    message: string;
  }>;
}

const PENDING_PROPOSALS_QUERY = `
  query PendingProposals($space: String!) {
    proposals(
      first: 20
      where: { space_in: [$space], state: "active" }
      orderBy: "created"
      orderDirection: desc
    ) {
      id
      title
      body
      created
      end
      state
      choices
      space {
        id
        name
      }
    }
  }
`;

function extractEvidenceUrls(body: string): string[] {
  return [...new Set(body.match(/https?:\/\/[^\s)<>'"`]+/g) ?? [])];
}

/**
 * Fetches currently active proposals from the selected public Snapshot space.
 * Snapshot's active state is the actionable proposal set for Sentinel.
 */
export async function fetchPendingProposals(): Promise<GovernanceProposal[]> {
  const response = await fetch(SNAPSHOT_HUB_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: PENDING_PROPOSALS_QUERY,
      variables: { space: SNAPSHOT_SPACE },
    }),
  });

  if (!response.ok) {
    throw new Error(`Snapshot proposal request failed: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as SnapshotResponse;
  if (payload.errors?.length) {
    throw new Error(`Snapshot proposal query failed: ${payload.errors.map((error) => error.message).join("; ")}`);
  }

  return (payload.data?.proposals ?? []).map((proposal) => {
    const source: ProposalSource = {
      kind: "snapshot",
      space: proposal.space.id,
      proposalId: proposal.id,
    };
    return {
      canonicalId: canonicalProposalId(source),
      source,
      title: proposal.title,
      bodyText: proposal.body,
      choices: proposal.choices ?? [],
      linkedEvidenceUrls: extractEvidenceUrls(proposal.body),
      submittedAt: new Date(proposal.created * 1_000).toISOString(),
      votingEndsAt: new Date(proposal.end * 1_000).toISOString(),
      status: proposal.state === "active" || proposal.state === undefined ? "active" : "unknown",
    } satisfies GovernanceProposal;
  });
}
