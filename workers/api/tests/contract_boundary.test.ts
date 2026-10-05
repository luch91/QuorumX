import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseDueDiligence } from "../src/due_diligence";

describe("Python contract to Worker boundary", () => {
  const root = path.resolve(__dirname, "../../..");
  const conformance = JSON.parse(readFileSync(path.join(root, "fixtures/contracts/v2/conformance.json"), "utf8"));
  it.each([
    ["halcyon", 1],
    ["eclipse", 6],
  ])("parses the exact %s record serialized by the v2 Python contract", (fixture, safeguardCount) => {
    const result = spawnSync(process.execPath, [path.join(root, "scripts", "generate_contract_fixture.cjs"), fixture], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    const raw = result.stdout.trim();
    const parsed = parseDueDiligence(raw, `snapshot:velvet-solace.test:${fixture}`);
    expect(parsed).toEqual(expect.objectContaining({
      assessmentVersion: "2",
      proposalKey: `snapshot:velvet-solace.test:${fixture}`,
      provenance: "fixture",
      reviewPriority: "high",
    }));
    expect(parsed?.findings[0].existingSafeguards).toHaveLength(safeguardCount);
  });

  it("enforces every mutation in the shared v2 conformance set", () => {
    const result = spawnSync(process.execPath, [path.join(root, "scripts", "generate_contract_fixture.cjs"), "eclipse"], {
      cwd: root, encoding: "utf8",
    });
    const base = JSON.parse(result.stdout);
    for (const testCase of conformance.cases) {
      const record = structuredClone(base);
      record.proposalKey = `snapshot:velvet-solace.test:${testCase.name}`;
      if (testCase.existingSafeguards !== undefined) {
        record.findings[0].existingSafeguards = Array.from({ length: testCase.existingSafeguards }, (_, i) => `Safeguard ${i + 1}`);
      }
      if (testCase.unknownRootField) record.futureField = true;
      const parse = () => parseDueDiligence(record, record.proposalKey);
      if (testCase.accepted) expect(parse()).toBeDefined(); else expect(parse).toThrow();
    }
  });
});
