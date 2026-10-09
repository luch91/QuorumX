const { existsSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const entrypoints = [path.join(root, "dist", "app", "src", "cli.js")];

for (const entrypoint of entrypoints) {
  if (!existsSync(entrypoint)) throw new Error(`Missing built CLI entry point: ${path.relative(root, entrypoint)}`);
}

const smoke = spawnSync(process.execPath, [entrypoints[0], "--help"], { cwd: root, encoding: "utf8" });
if (smoke.status !== 0 || !smoke.stdout.includes("quorumx sources check")) {
  process.stderr.write(smoke.stderr || smoke.stdout || "CLI help smoke failed\n");
  process.exitCode = smoke.status || 1;
} else {
  process.stdout.write(`verified ${entrypoints.length} built CLI entry points\n`);
}
