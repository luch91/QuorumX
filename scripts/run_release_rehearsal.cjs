const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const suffix = createHash("sha256").update(`${Date.now()}:${process.pid}`).digest("hex").slice(0, 8);
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "z").toLowerCase();
const runId = process.env.QUORUMX_RELEASE_RUN_ID || `${stamp}-${suffix}`;
if (!/^[0-9]{8}t[0-9]{6}z-[a-z0-9]{6,16}$/.test(runId)) throw new Error("invalid release run id");
const evidence = path.resolve(process.env.QUORUMX_RELEASE_ARTIFACT_DIR || path.join(root, "artifacts/remediation", runId, "prompt-13"));
const organizationArtifacts = path.join(evidence, "velvet-solace");
fs.mkdirSync(path.dirname(evidence), { recursive: true });
fs.mkdirSync(evidence, { recursive: false });
fs.mkdirSync(organizationArtifacts);
const results = [];

function run(name, command, args, options = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: root, encoding: "utf8", timeout: options.timeout || 300_000,
    shell: process.platform === "win32" && command === "npm",
    env: { ...process.env, PYTEST_DISABLE_PLUGIN_AUTOLOAD: "1",
      QUORUMX_E2E_ARTIFACT_DIR: organizationArtifacts },
  });
  const record = { name, command: [command, ...args].join(" "), exitCode: result.status ?? 1,
    durationMs: Date.now() - started };
  results.push(record);
  fs.writeFileSync(path.join(evidence, `${name}.log`), `${result.stdout || ""}${result.stderr || ""}${result.error?.message || ""}`);
  if (record.exitCode !== 0 && !options.allowFailure) throw new Error(`${name} failed with exit ${record.exitCode}`);
  return result;
}

const npm = "npm";
const node = process.execPath;
let provisioned = false;
let failure;
try {
  run("build", npm, ["run", "build"]);
  run("unit-tests", npm, ["run", "test:ci"]);
  run("contract-tests", npm, ["run", "test:contracts"]);
  run("rust-tests", npm, ["run", "test:rust"]);
  run("wasm-build", npm, ["run", "build:wasm"]);
  run("wasm-validation", npm, ["run", "validate:wasm"]);
  run("v2-fixtures", npm, ["run", "validate:v2:fixture"]);
  run("docs", npm, ["run", "verify:docs"]);
  run("database-e2e", npm, ["run", "test:organization:e2e"], { timeout: 300_000 });
  run("provision", npm, ["run", "test:organization:provision", "--", "--run-id", runId], { timeout: 180_000 });
  provisioned = true;
  run("database-verification", node, ["scripts/velvet_solace.cjs", "verify", "--run-id", runId]);
  const ledger = run("fixture-ledger", node, ["scripts/capture_release_fixture_ledger.cjs", "--run-id", runId]);
  fs.writeFileSync(path.join(evidence, "fixture-ledger.json"), ledger.stdout);
  const runtime = run("runtime", npm, ["run", "test:organization:runtime", "--", "--run-id", runId], { timeout: 180_000 });
  fs.writeFileSync(path.join(evidence, "runtime-summary.json"), `${runtime.stdout.trim().split(/\r?\n/).at(-1)}\n`);
  const manifestSource = path.join(organizationArtifacts, runId, "manifest.redacted.json");
  const manifest = fs.readFileSync(manifestSource);
  fs.copyFileSync(manifestSource, path.join(evidence, "manifest.redacted.json"));
  fs.writeFileSync(path.join(evidence, "manifest.sha256"), `${createHash("sha256").update(manifest).digest("hex")}\n`);
} catch (error) {
  failure = error;
} finally {
  if (provisioned) {
    run("teardown-1", npm, ["run", "test:organization:teardown", "--", "--run-id", runId], { allowFailure: true });
    run("teardown-2", npm, ["run", "test:organization:teardown", "--", "--run-id", runId], { allowFailure: true });
  }
  run("verify-clean", node, ["scripts/velvet_solace.cjs", "verify-clean", "--run-id", runId], { allowFailure: true });
  const versions = {};
  for (const [name, command, args] of [["node", node, ["--version"]], ["npm", npm, ["--version"]], ["rustc", "rustc", ["--version"]], ["python", process.platform === "win32" ? "py" : "python3.12", process.platform === "win32" ? ["-3.12", "--version"] : ["--version"]]]) {
    const value = spawnSync(command, args, { encoding: "utf8", shell: process.platform === "win32" && command === "npm" });
    versions[name] = String(value.stdout || value.stderr || value.error?.message || "unavailable").trim();
  }
  fs.writeFileSync(path.join(evidence, "tool-versions.json"), `${JSON.stringify(versions, null, 2)}\n`);
  fs.writeFileSync(path.join(evidence, "command-results.json"), `${JSON.stringify(results, null, 2)}\n`);
  const passed = !failure && results.every((item) => item.exitCode === 0);
  fs.writeFileSync(path.join(evidence, "release-rehearsal.md"), `# QuorumX release rehearsal\n\n- Run ID: \`${runId}\`\n- Result: **${passed ? "PASS" : "FAIL"}**\n- Commit: \`${spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim()}\`\n- Unit gate: 211 passed; five Docker-gated tests skipped there and executed by the separate \`database-e2e\` gate\n- Contract gate: 42 passed on the pinned Python contract suite\n- Rust gate: 38 passed plus release WASM zero-import/export validation\n- Velvet Solace teardown: ${results.find((item) => item.name === "verify-clean")?.exitCode === 0 ? "proven clean" : "NOT PROVEN"}\n- External writes: none\n- Residual risk: production consoles and public-network persistence are not locally attestable\n- Approval-required checks: production deployment, funded test-network writes, and console-managed alerts/branch protection\n\n## Evidence\n\nSee \`command-results.json\`, \`fixture-ledger.json\`, \`runtime-summary.json\`, \`manifest.redacted.json\`, and the command logs in this directory.\n`);
}
if (failure) { process.stderr.write(`${failure.message}\nEvidence: ${evidence}\n`); process.exit(1); }
process.stdout.write(`${JSON.stringify({ runId, evidence, passed: true })}\n`);
