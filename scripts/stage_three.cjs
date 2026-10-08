const { copyFileSync, mkdirSync } = require("node:fs");
const { dirname, resolve } = require("node:path");

const source = resolve(__dirname, "../node_modules/three/build/three.module.js");
const target = resolve(__dirname, "../frontend/vendor/three.module.js");

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log("Staged frontend/vendor/three.module.js from pinned Three.js.");
