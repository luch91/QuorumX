/** The sole proposal eligible for the first isolated schema-3.4 production canary. */
export const SCHEMA34_CANARY_BIP933 = "snapshot:balancer.eth:0x5a66f49d3aa02d9474e13acd1e6ac81d4a93398a8df0ec6b3adbe5170a74d3d8";

export const SCHEMA34_CANARY_RUN_ID = /^[A-Za-z0-9:._-]{1,120}$/;

export function assertSchema34CanaryIdentity(canonicalId: string, assessmentRunId: string): void {
  if (canonicalId !== SCHEMA34_CANARY_BIP933) throw new RangeError("schema34_canary_proposal_not_allowed");
  if (!SCHEMA34_CANARY_RUN_ID.test(assessmentRunId)) throw new RangeError("invalid_assessment_run_id");
}
