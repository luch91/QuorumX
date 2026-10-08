const { copyFileSync, mkdirSync } = require("node:fs");
const { dirname, resolve } = require("node:path");

const files = ["three.module.js", "three.core.js"];
for (const file of files) {
  const source = resolve(__dirname, `../node_modules/three/build/${file}`);
  const target = resolve(__dirname, `../frontend/vendor/${file}`);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}
console.log(`Staged ${files.join(" and ")} from pinned Three.js.`);
