const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const roots = ["README.md", "CONTRIBUTING.md", "SECURITY.md", "app/README.md", "contracts/README.md", "database/README.md", "workers/api/README.md"];
const docs = fs.readdirSync(path.join(root, "docs"), { recursive: true })
  .filter((name) => String(name).endsWith(".md")).map((name) => path.join("docs", String(name)));
const missing = [];
for (const relative of [...roots, ...docs]) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) { missing.push(relative); continue; }
  const text = fs.readFileSync(absolute, "utf8");
  for (const match of text.matchAll(/\[[^\]]*\]\((?!https?:|mailto:|#)([^)#]+)(?:#[^)]+)?\)/g)) {
    const target = path.resolve(path.dirname(absolute), decodeURIComponent(match[1]));
    if (!fs.existsSync(target)) missing.push(`${relative} -> ${match[1]}`);
  }
}
if (missing.length) {
  process.stderr.write(`missing documentation targets:\n${missing.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`${JSON.stringify({ checked: roots.length + docs.length, missing: 0 })}\n`);
