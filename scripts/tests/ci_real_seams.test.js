const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

describe("required real-seam CI coverage", () => {
  const workflow = read(".github/workflows/ci.yml");
  const packageJson = JSON.parse(read("package.json"));

  test("pins Python 3.12 and covers current contracts and validation scripts", () => {
    expect(workflow).toContain('python-version: "3.12"');
    expect(workflow).toContain("contracts/governance_due_diligence_v3_3.py");
    expect(workflow).toContain("run_v3_3_glsim_integration.sh");
    expect(workflow).not.toContain("dwcs/");
    expect(workflow).not.toContain("wasm32-unknown-unknown");
    expect(workflow).toContain("npm run validate:v2:fixture");
    expect(workflow).toContain("npm run cf:dry-run:api");
    expect(workflow).toContain("npm run cf:dry-run:site");
  });

  test("runs the disposable real workflow with teardown and failure evidence", () => {
    expect(workflow).toContain("test:organization:provision");
    expect(workflow).toContain("test:organization:e2e");
    expect(workflow).toContain("test:organization:runtime");
    expect(workflow).toContain("playwright install --with-deps chromium");
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain("test:organization:teardown");
    expect(workflow).toContain("actions/upload-artifact");
  });

  test("exposes stable local equivalents for every real seam", () => {
    for (const name of [
      "test:contracts", "validate:v2:fixture", "test:organization:runtime",
      "test:ci:real-seams", "test:genlayer:integration",
    ]) expect(packageJson.scripts[name]).toBeTruthy();
  });
});
