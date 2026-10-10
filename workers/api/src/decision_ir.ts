import { contractCanonicalJson } from "./canonical";

export const DECISION_IR_SCHEMA_VERSION = "3.4" as const;
export const DECISION_OPERATIONS = [
  "treasury_transfer", "treasury_recovery", "token_claim", "contract_call",
  "control_change", "parameter_change", "role_change", "grant_or_funding",
  "contract_upgrade", "deployment", "bridge", "stake", "unstake",
  "liquidity_action", "clawback_or_recovery", "signaling",
] as const;
export type DecisionOperation = typeof DECISION_OPERATIONS[number];

export interface DecisionAction {
  id: string;
  operation: DecisionOperation;
  sourceExcerpt: string;
  actor?: string;
  target?: string;
  contract?: string;
  function?: string;
  arguments?: string[];
  asset?: string;
  amount?: string;
  recipient?: string;
  frequency?: string;
  conditions: string[];
  dependencies: string[];
}

export interface DecisionClaim {
  id: string;
  statement: string;
  sourceExcerpt: string;
  verificationTarget: string;
}

export interface DecisionSafeguard {
  id: string;
  subject: string;
  state: "present" | "explicitly_absent" | "unknown";
  sourceExcerpt: string;
}

export interface DecisionConsequence {
  id: string;
  statement: string;
  sourceExcerpt: string;
}

export interface DecisionUnknown {
  id: string;
  subject: string;
  state: "unknown";
  sourceExcerpt: string;
}

export interface DecisionEvidenceReference {
  id: string;
  type: "proposal" | "external";
  locator: string;
  sourceExcerpt: string;
}

export interface DecisionIR {
  schemaVersion: typeof DECISION_IR_SCHEMA_VERSION;
  proposalObjective: string;
  actions: DecisionAction[];
  claims: DecisionClaim[];
  safeguards: DecisionSafeguard[];
  executionConsequences: DecisionConsequence[];
  unknowns: DecisionUnknown[];
  evidenceReferences: DecisionEvidenceReference[];
}

const MAX_ITEMS = 16;
const MAX_TEXT = 1_200;
const MAX_EXCERPT = 2_400;

function text(value: string | undefined, field: string, maximum = MAX_TEXT, optional = false): string | undefined {
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new Error(`Invalid Decision IR ${field}`);
  return value;
}

function array(values: string[] | undefined, field: string, maximum = 8): string[] {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.length > maximum) throw new Error(`Invalid Decision IR ${field}`);
  return values.map((value) => text(value, field, 300)!).sort();
}

function unique<T extends { id: string }>(items: T[], field: string): T[] {
  if (!Array.isArray(items) || items.length > MAX_ITEMS) throw new Error(`Invalid Decision IR ${field}`);
  const ids = new Set<string>();
  for (const item of items) {
    text(item.id, `${field} ID`, 80);
    if (ids.has(item.id)) throw new Error(`Duplicate Decision IR ${field} ID`);
    ids.add(item.id);
  }
  return [...items].sort((left, right) => left.id.localeCompare(right.id));
}

export function createDecisionIR(input: DecisionIR): DecisionIR {
  if (input.schemaVersion !== DECISION_IR_SCHEMA_VERSION) throw new Error("Unsupported Decision IR schema version");
  const actions = unique(input.actions, "action").map((action) => {
    if (!(DECISION_OPERATIONS as readonly string[]).includes(action.operation)) throw new Error("Invalid Decision IR action operation");
    return {
      id: text(action.id, "action ID", 80)!, operation: action.operation,
      sourceExcerpt: text(action.sourceExcerpt, "action source excerpt", MAX_EXCERPT)!,
      actor: text(action.actor, "action actor", MAX_TEXT, true), target: text(action.target, "action target", MAX_TEXT, true),
      contract: text(action.contract, "action contract", MAX_TEXT, true), function: text(action.function, "action function", 160, true),
      arguments: array(action.arguments, "action arguments"), asset: text(action.asset, "action asset", 160, true),
      amount: text(action.amount, "action amount", 160, true), recipient: text(action.recipient, "action recipient", MAX_TEXT, true),
      frequency: text(action.frequency, "action frequency", 160, true), conditions: array(action.conditions, "action conditions"), dependencies: array(action.dependencies, "action dependencies"),
    };
  });
  const claims = unique(input.claims, "claim").map((claim) => ({
    id: text(claim.id, "claim ID", 80)!, statement: text(claim.statement, "claim statement")!,
    sourceExcerpt: text(claim.sourceExcerpt, "claim source excerpt", MAX_EXCERPT)!, verificationTarget: text(claim.verificationTarget, "claim verification target")!,
  }));
  const safeguards = unique(input.safeguards, "safeguard").map((safeguard) => {
    if (!["present", "explicitly_absent", "unknown"].includes(safeguard.state)) throw new Error("Invalid Decision IR safeguard state");
    return { id: text(safeguard.id, "safeguard ID", 80)!, subject: text(safeguard.subject, "safeguard subject")!, state: safeguard.state,
      sourceExcerpt: text(safeguard.sourceExcerpt, "safeguard source excerpt", MAX_EXCERPT)! };
  });
  const executionConsequences = unique(input.executionConsequences, "consequence").map((consequence) => ({
    id: text(consequence.id, "consequence ID", 80)!, statement: text(consequence.statement, "consequence statement")!, sourceExcerpt: text(consequence.sourceExcerpt, "consequence source excerpt", MAX_EXCERPT)!,
  }));
  const unknowns = unique(input.unknowns, "unknown").map((unknown) => {
    if (unknown.state !== "unknown") throw new Error("Invalid Decision IR unknown state");
    return { id: text(unknown.id, "unknown ID", 80)!, subject: text(unknown.subject, "unknown subject")!, state: "unknown" as const,
      sourceExcerpt: text(unknown.sourceExcerpt, "unknown source excerpt", MAX_EXCERPT)! };
  });
  const evidenceReferences = unique(input.evidenceReferences, "evidence reference").map((reference) => {
    if (!["proposal", "external"].includes(reference.type)) throw new Error("Invalid Decision IR evidence type");
    return { id: text(reference.id, "evidence reference ID", 80)!, type: reference.type,
      locator: text(reference.locator, "evidence locator", MAX_TEXT)!, sourceExcerpt: text(reference.sourceExcerpt, "evidence source excerpt", MAX_EXCERPT)! };
  });
  return { schemaVersion: DECISION_IR_SCHEMA_VERSION, proposalObjective: text(input.proposalObjective, "proposal objective")!, actions, claims, safeguards, executionConsequences, unknowns, evidenceReferences };
}

export function serializeDecisionIR(input: DecisionIR): string {
  return contractCanonicalJson(createDecisionIR(input));
}
