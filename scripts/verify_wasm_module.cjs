const fs = require("node:fs");
const path = require("node:path");

const wasmPath = path.resolve(__dirname, "../dwcs/rust-module/target/wasm32-unknown-unknown/release/dwcs_scoring_module.wasm");
if (!fs.existsSync(wasmPath)) {
  process.stderr.write(`WASM artifact not found: ${wasmPath}\nRun npm run build:wasm first.\n`);
  process.exit(1);
}

const moduleObject = new WebAssembly.Module(fs.readFileSync(wasmPath));
const imports = WebAssembly.Module.imports(moduleObject);
const exportedNames = WebAssembly.Module.exports(moduleObject).map((item) => item.name);
const required = ["memory", "alloc", "dealloc", "rank_answer", "breakdown_answer"];
const missing = required.filter((name) => !exportedNames.includes(name));
const report = { bytes: fs.statSync(wasmPath).size, imports, exports: exportedNames, missing };
process.stdout.write(`${JSON.stringify(report)}\n`);
if (imports.length || missing.length) process.exit(1);
