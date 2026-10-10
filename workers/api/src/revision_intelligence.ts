import { revisionChanges, type ProposalChange } from "./revision_changes";

type Claim = { id?: string; claim?: string; claimScope?: string; status?: string; evidence?: string[]; evidenceAuthority?: string[] };
type Assessment = { materialClaims?: Claim[]; executionMap?: Array<Record<string, unknown>>; safeguardGaps?: Array<Record<string, unknown>>; reviewPriority?: string };
export type RevisionIntelligenceSnapshot = { id: string; observedAt: string; payload: { title?: string; bodyText?: string; choices?: string[] }; assessment?: Assessment };
export type RevisionIntelligenceChange = ProposalChange & { kind: "revision" | "claim_status" | "claim_evidence" | "claim_introduced" | "claim_removed" | "claim_changed" | "execution_change" | "safeguard_change" | "review_priority"; affected?: string; evidenceImpact?: "changed" };
export type RevisionIntelligence = { revisionId: string; changedAt: string; changes: RevisionIntelligenceChange[] };

const STOP = new Set(["the", "a", "an", "has", "have", "had", "was", "were", "is", "are", "for", "of", "to", "in", "at", "by", "and", "or", "with", "from", "this", "that", "proposal", "protocol", "program", "approximately", "about", "reported", "reports", "reached", "total"]);
const categories: Array<[string, RegExp]> = [
  ["monthly_active_users", /monthly\s+active\s+users?|\b(?:mau|active users?)\b/i], ["revenue", /\brevenue\b/i], ["volume", /\b(?:trading )?volume\b/i],
  ["funding", /\b(?:funding|budget|allocation)\b/i], ["safe_threshold", /\b(?:safe|multisig).{0,40}\b\d+\s*(?:\/|of)\s*\d+/i],
  ["returned_funds", /\b(?:returned|refund).{0,40}\b(?:funds?|eth|arb|usdc)\b/i], ["audit", /\b(?:audit|audited|security review)\b/i],
];

function normalizedWords(value: string): string[] {
  return value.toLowerCase().replace(/monthly\s+active\s+users?/g, "mau").replace(/\bactive users?\b/g, "mau")
    .replace(/\busers?\b/g, "user").replace(/\bmembers?\b/g, "member").replace(/\d[\d,.]*(?:\s*(?:%|k|m|b|million|billion))?/g, " ")
    .replace(/0x[a-f0-9]{40}/g, " ").split(/[^a-z]+/).filter((word) => word.length > 2 && !STOP.has(word));
}

/** A bounded identity: exact normalized category/signature, never general semantic matching. */
export function stableMaterialClaimId(claim: Claim): string {
  const text = String(claim.claim ?? "");
  const category = categories.find(([, pattern]) => pattern.test(text))?.[0] ?? "text";
  const words = [...new Set(normalizedWords(text))].sort().slice(0, 8);
  // MAU is an explicitly bounded metric identity; other categories retain their normalized subject terms.
  return `${claim.claimScope ?? "unknown"}:${category}:${category === "monthly_active_users" ? "metric" : words.join("-")}`;
}

function title(value: unknown): string { return String(value ?? "").replace(/_/g, " ").replace(/\b\w/g, (part) => part.toUpperCase()); }
function fingerprint(value: unknown): string { return JSON.stringify(value ?? null); }
function add(changes: RevisionIntelligenceChange[], change: RevisionIntelligenceChange): void { changes.push(change); }

function claimChanges(previous: Assessment | undefined, current: Assessment | undefined): RevisionIntelligenceChange[] {
  const changes: RevisionIntelligenceChange[] = [];
  const prior = new Map((previous?.materialClaims ?? []).map((claim) => [stableMaterialClaimId(claim), claim]));
  const next = new Map((current?.materialClaims ?? []).map((claim) => [stableMaterialClaimId(claim), claim]));
  for (const [id, claim] of prior) {
    const now = next.get(id);
    if (!now) { add(changes, { field: "Material claim", previousValue: String(claim.claim ?? ""), currentValue: "Removed", significance: "material", explanation: "A bounded material-claim identity was not identified in this revision.", kind: "claim_removed", affected: id }); continue; }
    if (claim.status !== now.status) add(changes, { field: "Claim verification status", previousValue: title(claim.status), currentValue: title(now.status), significance: "material", explanation: "The matched material claim has a different evidence-backed status.", kind: "claim_status", affected: id });
    if (fingerprint([claim.evidence, claim.evidenceAuthority]) !== fingerprint([now.evidence, now.evidenceAuthority])) add(changes, { field: "Claim evidence", previousValue: "Previous evidence set", currentValue: "Evidence set changed", significance: "material", explanation: "Evidence attached to the matched claim changed between immutable revisions.", kind: "claim_evidence", affected: id, evidenceImpact: "changed" });
    if (String(claim.claim) !== String(now.claim)) add(changes, { field: "Material claim", previousValue: String(claim.claim), currentValue: String(now.claim), significance: "material", explanation: "The same bounded claim subject was rewritten or its stated value changed.", kind: "claim_changed", affected: id });
  }
  for (const [id, claim] of next) if (!prior.has(id)) add(changes, { field: "Material claim", previousValue: "Not identified", currentValue: String(claim.claim ?? ""), significance: "material", explanation: "A new bounded material claim was introduced in this revision.", kind: "claim_introduced", affected: id });
  return changes;
}

function keyed(values: Array<Record<string, unknown>> | undefined, key: (value: Record<string, unknown>) => string): Map<string, Record<string, unknown>> { return new Map((values ?? []).map((value) => [key(value), value])); }
function consequenceChanges(previous: Assessment | undefined, current: Assessment | undefined): RevisionIntelligenceChange[] {
  const changes: RevisionIntelligenceChange[] = [];
  const oldSteps = keyed(previous?.executionMap, (step) => normalizedWords(String(step.action ?? "")).sort().join("-") || String(step.id ?? ""));
  const newSteps = keyed(current?.executionMap, (step) => normalizedWords(String(step.action ?? "")).sort().join("-") || String(step.id ?? ""));
  for (const [id, step] of oldSteps) {
    const now = newSteps.get(id);
    if (!now) {
      add(changes, { field: "Execution path", previousValue: String(step.action ?? "Execution step"), currentValue: "Execution step no longer identified", significance: "material", explanation: "A previously described execution step was not identified in this revision.", kind: "execution_change", affected: id });
    } else if (fingerprint([step.actor, step.target, step.amount, step.asset, step.dependency, step.reversible]) !== fingerprint([now.actor, now.target, now.amount, now.asset, now.dependency, now.reversible])) {
      add(changes, { field: "Execution path", previousValue: "Previous execution details", currentValue: "Execution details changed", significance: "material", explanation: "Actor, target, dependency, amount, asset, or reversibility changed for a matched execution step.", kind: "execution_change", affected: id });
    }
  }
  for (const [id, step] of newSteps) if (!oldSteps.has(id)) add(changes, { field: "Execution path", previousValue: "Not identified", currentValue: "Execution step added", significance: "material", explanation: `A new execution step was described: ${String(step.action ?? "execution step")}.`, kind: "execution_change", affected: id });
  const oldGaps = keyed(previous?.safeguardGaps, (gap) => normalizedWords(String(gap.safeguard ?? "")).sort().join("-") || String(gap.id ?? ""));
  const newGaps = keyed(current?.safeguardGaps, (gap) => normalizedWords(String(gap.safeguard ?? "")).sort().join("-") || String(gap.id ?? ""));
  for (const [id, gap] of oldGaps) {
    const now = newGaps.get(id);
    if (!now) {
      add(changes, { field: "Safeguard", previousValue: String(gap.safeguard ?? "Safeguard"), currentValue: "Safeguard no longer identified", significance: "material", explanation: "A previously identified safeguard was not identified in this revision.", kind: "safeguard_change", affected: id });
    } else if (fingerprint([gap.state, gap.scope]) !== fingerprint([now.state, now.scope])) {
      add(changes, { field: "Safeguard", previousValue: title(gap.state), currentValue: title(now.state), significance: "material", explanation: "The review state or reviewed scope changed for a matched safeguard.", kind: "safeguard_change", affected: id });
    }
  }
  for (const [id, gap] of newGaps) if (!oldGaps.has(id)) add(changes, { field: "Safeguard", previousValue: "Not identified", currentValue: "Safeguard added", significance: "material", explanation: `A safeguard was newly identified: ${String(gap.safeguard ?? "safeguard")}.`, kind: "safeguard_change", affected: id });
  if (previous?.reviewPriority && current?.reviewPriority && previous.reviewPriority !== current.reviewPriority) add(changes, { field: "Review priority", previousValue: title(previous.reviewPriority), currentValue: title(current.reviewPriority), significance: "material", explanation: "The amount of human attention warranted changed; this is not voting advice.", kind: "review_priority" });
  return changes;
}

export function buildRevisionIntelligence(revisions: RevisionIntelligenceSnapshot[]): RevisionIntelligence[] {
  return revisions.slice(1).map((current, index) => {
    const previous = revisions[index];
    const changes = revisionChanges(previous.payload, current.payload).map((change) => ({ ...change, kind: "revision" as const }));
    return { revisionId: current.id, changedAt: current.observedAt, changes: [...changes, ...claimChanges(previous.assessment, current.assessment), ...consequenceChanges(previous.assessment, current.assessment)] };
  }).filter((entry) => entry.changes.some((change) => change.significance === "material"));
}
