const { spawnSync } = require("node:child_process");
const path = require("node:path");

const script = path.join(__dirname, "generate_contract_fixture.py");
const configured = process.env.PYTHON_312;
const candidates = configured
  ? [[configured, []]]
  : process.platform === "win32"
    ? [["py", ["-3.12"]], ["python", []]]
    : [["python3.12", []], ["python3", []]];

let last;
for (const [binary, prefix] of candidates) {
  const result = spawnSync(binary, [...prefix, script, ...process.argv.slice(2)], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" });
  last = result;
  if (result.status === 0) {
    process.stdout.write(result.stdout);
    process.exit(0);
  }
  if (result.error?.code !== "ENOENT") break;
}
process.stderr.write(last?.stderr || last?.error?.message || "Python 3.12 is required\n");
process.exit(1);
