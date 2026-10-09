const fs = require("node:fs");

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
const REQUIRED_SPACES = ["safe.eth", "arbitrumfoundation.eth", "ens.eth"];

function assertExecutionSucceeded(receipt) {
  if (!receipt || !["ACCEPTED", "FINALIZED"].includes(receipt.status_name)) {
    throw new Error("transaction did not reach an accepted lifecycle state");
  }
  const leader = receipt.consensus_data?.leader_receipt?.find((item) => item.mode === "leader");
  if (!leader || leader.execution_result !== "SUCCESS" || leader.genvm_result?.raw_error) {
    throw new Error("transaction execution did not succeed");
  }
  return true;
}

function assertReleaseRecord(record, expected) {
  if (record?.assessmentVersion !== "3" || record?.assessmentSchemaVersion !== "3.3") {
    throw new Error("stored assessment is not schema 3.3");
  }
  if (record.assessmentRunId !== expected.runId || record.proposalKey !== expected.proposalKey
      || record.contentHash !== expected.contentHash || !HASH.test(record.contentHash)) {
    throw new Error("stored assessment identity or content hash does not match");
  }
  const evidenceIds = new Set((record.evidence ?? []).map((item) => item.id));
  if (evidenceIds.size === 0) throw new Error("stored assessment has no evidence");
  for (const item of [...(record.materialClaims ?? []), ...(record.findings ?? [])]) {
    if (!(item.evidence ?? []).every((id) => evidenceIds.has(id))) {
      throw new Error("stored assessment contains a dangling evidence reference");
    }
  }
  return true;
}

function validateReleaseConfig(config) {
  if (config.assessmentVersion !== "3" || !ADDRESS.test(config.v3Address ?? "") || !ADDRESS.test(config.v2Address ?? "")) {
    throw new Error("release contract configuration is invalid");
  }
  const spaces = new Set((config.spaces ?? []).map((space) => String(space).toLowerCase()));
  if (REQUIRED_SPACES.some((space) => !spaces.has(space))) throw new Error("release configuration is missing required DAO coverage");
  return { ...config, rollbackAssessmentVersion: "2" };
}

if (require.main === module) {
  const [receiptPath, recordPath, expectedPath, configPath] = process.argv.slice(2);
  if (!receiptPath || !recordPath || !expectedPath || !configPath) {
    throw new Error("usage: node scripts/verify_v3_3_release.cjs <receipt.json> <record.json> <expected.json> <config.json>");
  }
  assertExecutionSucceeded(JSON.parse(fs.readFileSync(receiptPath, "utf8")));
  assertReleaseRecord(JSON.parse(fs.readFileSync(recordPath, "utf8")), JSON.parse(fs.readFileSync(expectedPath, "utf8")));
  const checked = validateReleaseConfig(JSON.parse(fs.readFileSync(configPath, "utf8")));
  process.stdout.write(JSON.stringify({ ok: true, schema: "3.3", rollbackAssessmentVersion: checked.rollbackAssessmentVersion }) + "\n");
}

module.exports = { assertExecutionSucceeded, assertReleaseRecord, validateReleaseConfig };
