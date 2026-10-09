const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

describe("documentation and configuration parity", () => {
  test("version, schema, assessment mode, and write defaults agree", () => {
    const pkg = JSON.parse(read("package.json"));
    const worker = read("workers/api/src/index.ts");
    const config = read("wrangler.jsonc");
    const env = read(".env.example");
    expect(pkg.version).toBe("0.4.0");
    expect(worker).toContain('SERVICE_VERSION = "0.4.0"');
    expect(config).toContain('"QUORUMX_ASSESSMENT_VERSION": "3"');
    expect(config).toContain('"QUORUMX_ENABLE_WRITES": "true"');
    expect(env).toContain("QUORUMX_ASSESSMENT_VERSION=3");
    expect(read("database/README.md")).toContain("0010_runtime_privilege_matrix.sql");
  });

  test("required operator documents and checks exist", () => {
    for (const file of ["docs/OPERATIONS.md", "docs/RELEASE_CHECKLIST.md", "docs/OPEN_QUESTIONS.md"])
      expect(fs.existsSync(path.join(root, file))).toBe(true);
    expect(JSON.parse(read("package.json")).scripts["verify:docs"]).toBeTruthy();
  });
});
