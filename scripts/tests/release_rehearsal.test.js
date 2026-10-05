const fs = require("node:fs");
const path = require("node:path");

const script = fs.readFileSync(path.resolve(__dirname, "../run_release_rehearsal.cjs"), "utf8");

describe("release rehearsal contract", () => {
  test("uses one run identity and always proves idempotent cleanup", () => {
    expect(script).toContain("test:organization:provision");
    expect(script).toContain("test:organization:runtime");
    expect(script).toContain("test:organization:e2e");
    expect(script.match(/test:organization:teardown/g)).toHaveLength(2);
    expect(script).toContain("verify-clean");
    expect(script).toContain("finally");
  });

  test("captures required redacted release evidence", () => {
    for (const name of [
      "manifest.redacted.json", "manifest.sha256", "release-rehearsal.md",
      "tool-versions.json", "fixture-ledger.json", "command-results.json",
    ]) expect(script).toContain(name);
    expect(script).not.toMatch(/privateKey|adminUrl|runtimeUrl/);
  });
});
