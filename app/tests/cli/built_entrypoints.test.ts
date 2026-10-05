import { readFileSync } from "node:fs";
import path from "node:path";

describe("built CLI entry points", () => {
  it("points every compiled command at the app build tree", () => {
    const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"));
    expect(packageJson.scripts).toEqual(expect.objectContaining({
      quorumx: "node dist/app/src/cli.js",
      "start:sentinel": "node dist/app/src/legacy_cli.js",
      "legacy:telegraph": "node dist/app/src/legacy_cli.js",
      "smoke:sentinel": "node dist/app/src/smoke_cli.js",
      "preflight:sentinel": "node dist/app/src/preflight_cli.js",
      "metrics:sentinel": "node dist/app/src/metrics_cli.js",
      "verify:cli": "node scripts/verify_cli_entrypoints.cjs",
    }));
    expect(packageJson.scripts.verify).toContain("npm run verify:cli");
  });
});
