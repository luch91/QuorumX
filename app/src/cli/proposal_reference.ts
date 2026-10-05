import type { ProposalSource } from "../domain/governance_proposal";

function configuredSpace(space: string, spaces: string[]): string {
  const normalized = space.trim().toLowerCase();
  if (!spaces.includes(normalized)) throw new Error(`Proposal reference uses unconfigured Snapshot space: ${normalized}`);
  return normalized;
}

export function parseSnapshotReference(input: string, spaces: string[]): ProposalSource {
  const reference = input.trim();
  if (!reference) throw new Error("Invalid Snapshot proposal reference");

  if (reference.startsWith("snapshot:")) {
    const [, space, ...proposalParts] = reference.split(":");
    const proposalId = proposalParts.join(":").trim();
    if (!space || !proposalId) throw new Error("Invalid Snapshot proposal reference");
    return { kind: "snapshot", space: configuredSpace(space, spaces), proposalId };
  }

  if (/^https?:/i.test(reference)) {
    const url = new URL(reference);
    if (url.protocol !== "https:" || !["snapshot.org", "snapshot.box"].includes(url.hostname.toLowerCase())) {
      throw new Error("Invalid Snapshot proposal reference URL");
    }
    const fragment = decodeURIComponent(url.hash.replace(/^#\/?/, ""));
    const match = fragment.match(/^(?:s:)?([^/]+)\/proposal\/([^/?#]+)$/);
    if (!match) throw new Error("Invalid Snapshot proposal reference URL");
    return { kind: "snapshot", space: configuredSpace(match[1], spaces), proposalId: match[2] };
  }

  const colon = reference.indexOf(":");
  if (colon >= 0) {
    const space = reference.slice(0, colon);
    const proposalId = reference.slice(colon + 1).trim();
    if (!proposalId) throw new Error("Invalid Snapshot proposal reference");
    return { kind: "snapshot", space: configuredSpace(space, spaces), proposalId };
  }

  if (!spaces[0]) throw new Error("No configured Snapshot space is available for the proposal reference");
  if (spaces.length !== 1) throw new Error("Bare Snapshot proposal reference is ambiguous; include the configured space");
  return { kind: "snapshot", space: spaces[0], proposalId: reference };
}
