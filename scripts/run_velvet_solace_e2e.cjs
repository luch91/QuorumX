const { spawnSync } = require("node:child_process");

const result = spawnSync(
  process.execPath,
  [require.resolve("jest/bin/jest"), "--runInBand", "app/tests/integration/velvet_solace_database.test.ts"],
  { stdio: "inherit", env: { ...process.env, QUORUMX_RUN_DOCKER_E2E: "true" } },
);
process.exitCode = result.status ?? 1;
