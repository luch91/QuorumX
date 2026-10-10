import { contractCanonicalJson } from "../src/canonical";
import { createDecisionIR, serializeDecisionIR } from "../src/decision_ir";
import type { StoredDueDiligenceV3Assessment } from "../src/domain";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bip933Excerpt = "The DAO multisig can recover the USDC by atomically calling claimFees(FeeDistributor, USDC, DAO, 0) four times. This is necessary because the grant has accumulated more than 60 weeks of unclaimed USDC, while the FeeDistributor settles at most 20 weeks per call.";

function bip933() {
  return createDecisionIR({
    schemaVersion: "3.4",
    proposalObjective: "Recover unclaimed USDC FeeDistributor rewards.",
    actions: [{
      id: "action-claim-fees", actor: "DAO multisig", operation: "token_claim",
      target: "Timeless VeBalGrant", function: "claimFees",
      arguments: ["FeeDistributor", "USDC", "DAO", "0"], asset: "USDC",
      amount: "approximately 10,286.807445", recipient: "DAO", frequency: "4 calls",
      conditions: ["FeeDistributor settles at most 20 weeks per call"],
      dependencies: ["More than 60 weeks of unclaimed USDC accumulated"], sourceExcerpt: bip933Excerpt,
    }],
    claims: [{ id: "claim-unclaimed-usdc", statement: "Approximately 10,286.807445 USDC remains unclaimed.", sourceExcerpt: bip933Excerpt, verificationTarget: "FeeDistributor reward balance" }],
    safeguards: [], executionConsequences: [], unknowns: [],
    evidenceReferences: [{ id: "proposal", type: "proposal", locator: "https://snapshot.box/#/s:balancer.eth/proposal/0x5a66f49d3aa02d9474e13acd1e6ac81d4a93398a8df0ec6b3adbe5170a74d3d8", sourceExcerpt: bip933Excerpt }],
  });
}

describe("Decision IR schema 3.4", () => {
  test("serializes equivalent action order deterministically", () => {
    const first = createDecisionIR({ ...bip933(), actions: [
      ...bip933().actions,
      { id: "action-follow-up", actor: "DAO", operation: "signaling", target: "DAO", conditions: [], dependencies: [], sourceExcerpt: "Record the decision." },
    ] });
    const second = createDecisionIR({ ...first, actions: [...first.actions].reverse() });
    expect(serializeDecisionIR(first)).toBe(serializeDecisionIR(second));
    expect(JSON.parse(serializeDecisionIR(first)).schemaVersion).toBe("3.4");
  });

  test("represents a generic contract call and multiple actions", () => {
    const decision = createDecisionIR({ ...bip933(), actions: [
      ...bip933().actions,
      { id: "action-set-fee", actor: "DAO", operation: "contract_call", contract: "FeeController", function: "setFee", arguments: ["500"], target: "FeeController", conditions: [], dependencies: [], sourceExcerpt: "Set the fee parameter." },
    ] });
    expect(decision.actions).toHaveLength(2);
    expect(decision.actions.find((action) => action.id === "action-set-fee")).toMatchObject({ operation: "contract_call", function: "setFee" });
  });

  test("keeps unknown distinct from explicitly absent", () => {
    const decision = createDecisionIR({ ...bip933(),
      safeguards: [{ id: "recovery", state: "explicitly_absent", subject: "Recovery mechanism", sourceExcerpt: "No recovery mechanism will apply." }],
      unknowns: [{ id: "recipient-controller", subject: "Recipient controller", state: "unknown", sourceExcerpt: "No controller is identified." }],
    });
    expect(decision.safeguards[0].state).toBe("explicitly_absent");
    expect(decision.unknowns[0].state).toBe("unknown");
  });

  test("represents a signaling proposal without executable actions", () => {
    const decision = createDecisionIR({ schemaVersion: "3.4", proposalObjective: "Signal whether to ban Good Entry from future programs.", actions: [], claims: [], safeguards: [], executionConsequences: [], unknowns: [], evidenceReferences: [] });
    expect(decision.actions).toEqual([]);
    expect(decision.proposalObjective).toContain("Signal");
  });

  test("represents BIP-933 claimFees details without inventing unknown values", () => {
    const action = bip933().actions[0];
    expect(action).toMatchObject({ actor: "DAO multisig", operation: "token_claim", function: "claimFees", asset: "USDC", amount: "approximately 10,286.807445", recipient: "DAO", frequency: "4 calls" });
    expect(action.dependencies).toContain("More than 60 weeks of unclaimed USDC accumulated");
  });

  test("keeps the captured BIP-933 proposal as a real benchmark fixture", () => {
    const fixture = JSON.parse(readFileSync(resolve(process.cwd(), "fixtures/decision_ir/bip_933.json"), "utf8"));
    expect(fixture).toMatchObject({ space: "balancer.eth", proposalId: "0x5a66f49d3aa02d9474e13acd1e6ac81d4a93398a8df0ec6b3adbe5170a74d3d8" });
    expect(fixture.body).toContain("claimFees(FeeDistributor, USDC, DAO, 0)");
  });

  test("rejects an unbounded action collection", () => {
    const action = bip933().actions[0];
    expect(() => createDecisionIR({ ...bip933(), actions: Array.from({ length: 17 }, (_, index) => ({ ...action, id: `action-${index}` })) })).toThrow("Invalid Decision IR action");
  });

  test("serializes an additive deterministic grounding report", () => {
    const grounded = createDecisionIR({ ...bip933(), grounding: {
      proposalObjective: "unresolved",
      actions: [{ id: "action-claim-fees", state: "grounded", retained: true, fields: [
        { field: "asset", state: "grounded" },
        { field: "recipient", state: "grounded" },
      ] }],
    } });
    expect(JSON.parse(serializeDecisionIR(grounded)).grounding.actions[0]).toMatchObject({
      id: "action-claim-fees", state: "grounded", retained: true,
    });
  });

  test("does not change schema 3.3 type compatibility", () => {
    const legacy: Pick<StoredDueDiligenceV3Assessment, "assessmentVersion" | "assessmentSchemaVersion" | "proposalKey"> = { assessmentVersion: "3", assessmentSchemaVersion: "3.3", proposalKey: "snapshot:dao.eth:legacy" };
    expect(contractCanonicalJson(legacy)).toContain('"assessmentSchemaVersion":"3.3"');
  });
});
