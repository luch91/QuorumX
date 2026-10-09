import { readFileSync } from "node:fs";
import path from "node:path";

describe("built CLI entry points", () => {
  it("exposes only the current QuorumX CLI entry point", () => {
    const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"));
    expect(packageJson.scripts).toEqual(expect.objectContaining({
      quorumx: "node dist/app/src/cli.js",
      "verify:cli": "node scripts/verify_cli_entrypoints.cjs",
    }));
    expect(Object.keys(packageJson.scripts)).not.toEqual(expect.arrayContaining([
      "start:sentinel", "legacy:telegraph", "smoke:sentinel", "preflight:sentinel", "metrics:sentinel",
      "test:dwcs", "test:rust", "build:wasm", "validate:wasm",
    ]));
    expect(packageJson.dependencies).not.toHaveProperty("@x402/evm");
    expect(packageJson.dependencies).not.toHaveProperty("@x402/fetch");
    expect(packageJson.scripts.verify).toContain("npm run verify:cli");
  });
});
