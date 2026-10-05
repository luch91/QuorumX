const { spawnSync } = require("node:child_process");
const path = require("node:path");

const generator = path.join(__dirname, "generate_contract_fixture.cjs");
const cases = ["halcyon", "eclipse"];
for (const fixtureCase of cases) {
  const result = spawnSync(process.execPath, [generator, fixtureCase], { encoding: "utf8", cwd: path.resolve(__dirname, "..") });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || `fixture generation failed for ${fixtureCase}\n`);
    process.exit(result.status || 1);
  }
  const record = JSON.parse(result.stdout);
  if (record.assessmentVersion !== "2" || record.consensus?.state !== "accepted" || !record.contentHash) {
    process.stderr.write(`invalid v2 boundary fixture: ${fixtureCase}\n`);
    process.exit(1);
  }
  if (fixtureCase === "eclipse" && record.findings[0].existingSafeguards.length !== 6) {
    process.stderr.write("Eclipse did not preserve six safeguards\n");
    process.exit(1);
  }
}
process.stdout.write(`${JSON.stringify({ valid: true, cases })}\n`);
