const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

describe("database runtime-role provisioning", () => {
  it("types the password parameter before PostgreSQL format() quotes it", () => {
    const source = readFileSync(resolve(process.cwd(), "scripts/provision_database_role.cjs"), "utf8");
    expect(source).toMatch(/format\('create role quorumx_runtime with login password %L', \$1::text\)/);
  });
});
