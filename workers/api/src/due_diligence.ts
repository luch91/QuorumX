import type { StoredDueDiligenceAssessment } from "./domain";

const HASH = /^[0-9a-f]{64}$/;
const FINDING_TYPES = new Set([
  "treasury_exposure", "execution_dependency", "governance_change", "permission_change",
  "counterparty_exposure", "missing_safeguard", "claim_discrepancy", "evidence_gap",
  "irreversibility", "smart_contract_exposure", "other",
]);
const CLAIM_STATES = new Set(["supported", "partially_supported", "unverified", "contradicted", "not_applicable"]);
const SEVERITIES = new Set(["informational", "low", "medium", "high", "critical"]);
const CONFIDENCES = new Set(["low", "medium", "high"]);
const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid v2 ${field}`);
  return value as Record<string, unknown>;
}

function string(value: unknown, field: string, max = 400, optional = false): string {
  if (typeof value !== "string" || (!optional && !value.trim()) || value.length > max) throw new Error(`Invalid v2 ${field}`);
  return value;
}

function list(value: unknown, field: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`Invalid v2 ${field}`);
  return value;
}

function stringList(value: unknown, field: string, max: number): string[] {
  return list(value, field, max).map((item) => string(item, field, 300));
}

function reversible(value: unknown): boolean {
  return value === true || value === false || value === "partial" || value === "unknown";
}

function derivedPriority(findings: StoredDueDiligenceAssessment["findings"], questions: unknown[]): string {
  if (findings.some((finding) => finding.severity === "critical")) return "urgent";
  if (findings.some((finding) => finding.severity === "high")) return "high";
  if (findings.some((finding) => finding.severity === "medium") || questions.length) return "normal";
  return "low";
}

export function parseDueDiligence(raw: unknown, proposalKey: string): StoredDueDiligenceAssessment | undefined {
  if (raw === "" || raw === null || raw === undefined) return undefined;
  const record = object(typeof raw === "string" ? JSON.parse(raw) : raw, "record");
  if (JSON.stringify(record).length > 25_000 || record.assessmentVersion !== "2" || record.proposalKey !== proposalKey) {
    throw new Error("Invalid v2 assessment identity or size");
  }
  if (typeof record.contentHash !== "string" || !HASH.test(record.contentHash)
    || typeof record.sourceLocatorHash !== "string" || !HASH.test(record.sourceLocatorHash)) {
    throw new Error("Invalid v2 assessment hashes");
  }
  const overview = object(record.overview, "overview");
  string(overview.purpose, "overview purpose");
  if (!stringList(overview.requestedActions, "requested actions", 8).length) throw new Error("Missing v2 action");
  stringList(overview.assetsAffected, "assets", 6);
  stringList(overview.permissionsChanged, "permissions", 6);
  stringList(overview.controlChanges, "controls", 6);

  const evidence = list(record.evidence, "evidence", 12).map((rawItem) => {
    const item = object(rawItem, "evidence entry");
    if (item.type !== "proposal" || item.verificationScope !== "validator_retrieved_proposal"
      || item.contentHash !== record.contentHash || !String(item.locator).startsWith("https://snapshot.box/#/s:")) {
      throw new Error("Invalid v2 evidence authority");
    }
    string(item.id, "evidence ID", 32);
    string(item.description, "evidence description", 180);
    return item;
  });
  const evidenceIds = new Set(evidence.map((item) => item.id));
  if (evidenceIds.size !== evidence.length) throw new Error("Duplicate v2 evidence ID");
  const refs = (value: unknown, field: string) => {
    const ids = stringList(value, field, 6);
    if (!ids.length || ids.some((id) => !evidenceIds.has(id))) throw new Error(`Invalid v2 ${field}`);
    return ids;
  };

  const claims = list(record.materialClaims, "claims", 8).map((rawItem) => {
    const item = object(rawItem, "claim");
    string(item.id, "claim ID", 32); string(item.claim, "claim", 300);
    string(item.sourceExcerpt, "claim excerpt", 280); string(item.explanation, "claim explanation", 400);
    if (item.claimScope !== "proposal_action" && item.claimScope !== "external_factual") {
      throw new Error("Invalid v2 claim scope");
    }
    if (typeof item.counterExcerpt !== "string" || item.counterExcerpt.length > 280) {
      throw new Error("Invalid v2 counter excerpt");
    }
    if (!CLAIM_STATES.has(String(item.status)) || !CONFIDENCES.has(String(item.confidence))) throw new Error("Invalid v2 claim state");
    if (item.claimScope === "external_factual"
      && ["supported", "partially_supported", "contradicted"].includes(String(item.status))) {
      throw new Error("V2 proposal-only evidence cannot verify an external claim");
    }
    if (item.status === "contradicted" && !item.counterExcerpt) {
      throw new Error("Contradicted v2 claim needs opposing evidence");
    }
    refs(item.evidence, "claim references");
    return item;
  });
  if (new Set(claims.map((item) => item.id)).size !== claims.length) throw new Error("Duplicate v2 claim ID");

  const findings = list(record.findings, "findings", 6).map((rawItem) => {
    const item = object(rawItem, "finding");
    string(item.id, "finding ID", 32); string(item.title, "finding title", 120);
    string(item.sourceExcerpt, "finding excerpt", 280);
    string(item.observation, "observation", 400); string(item.whyItMatters, "importance", 400);
    if (!FINDING_TYPES.has(String(item.type)) || !SEVERITIES.has(String(item.severity))
      || !CONFIDENCES.has(String(item.confidence)) || !reversible(item.reversible)) {
      throw new Error("Invalid v2 finding classification");
    }
    refs(item.evidence, "finding references");
    stringList(item.existingSafeguards, "existing safeguards", 5);
    stringList(item.missingSafeguards, "missing safeguards", 5);
    string(item.enforcementMechanism, "enforcement mechanism", 240, true);
    string(item.recoveryMechanism, "recovery mechanism", 240, true);
    stringList(item.humanDependencies, "human dependencies", 4);
    stringList(item.technicalDependencies, "technical dependencies", 4);
    const findingConsensus = object(item.consensus, "finding consensus");
    if (findingConsensus.state !== "accepted" || findingConsensus.method !== "source_grounded_material_facts_v2") {
      throw new Error("Invalid v2 finding consensus");
    }
    return item;
  });
  if (new Set(findings.map((item) => item.id)).size !== findings.length) throw new Error("Duplicate v2 finding ID");

  const steps = list(record.executionMap, "execution map", 8).map((rawItem, index) => {
    const item = object(rawItem, "execution step");
    string(item.id, "step ID", 32); string(item.action, "step action", 250);
    if (item.order !== index + 1 || !reversible(item.reversible)) throw new Error("Invalid v2 execution order");
    refs(item.evidence, "step references");
    return item;
  });
  const findingIds = new Set(findings.map((item) => item.id));
  const questions = list(record.unresolvedQuestions, "questions", 6).map((rawItem) => {
    const item = object(rawItem, "question");
    string(item.id, "question ID", 32); string(item.question, "question", 240);
    string(item.whyItMatters, "question importance", 300);
    if (stringList(item.relatedFindingIds, "related findings", 6).some((id) => !findingIds.has(id))) {
      throw new Error("Invalid v2 related finding");
    }
    return item;
  });
  if (!PRIORITIES.has(String(record.reviewPriority))
    || record.reviewPriority !== derivedPriority(findings as unknown as StoredDueDiligenceAssessment["findings"], questions)) {
    throw new Error("Invalid v2 review priority");
  }
  string(record.reviewPriorityExplanation, "review priority explanation", 350);
  string(record.assessedAt, "assessment time", 80);
  if (record.provenance !== "live" && record.provenance !== "fixture") throw new Error("Invalid v2 provenance");
  const consensus = object(record.consensus, "consensus");
  if (consensus.state !== "accepted" || consensus.method !== "source_grounded_material_facts_v2") {
    throw new Error("Invalid v2 consensus method");
  }
  return record as unknown as StoredDueDiligenceAssessment;
}

export function claimStatusCounts(claims: StoredDueDiligenceAssessment["materialClaims"]) {
  return claims.reduce<Record<string, number>>((counts, claim) => {
    counts[claim.status] = (counts[claim.status] ?? 0) + 1;
    return counts;
  }, { supported: 0, partially_supported: 0, unverified: 0, contradicted: 0, not_applicable: 0 });
}
