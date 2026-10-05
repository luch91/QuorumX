import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../..");
const script = path.join(root, "scripts", "velvet_solace.cjs");

function run(...args: string[]) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, QUORUMX_E2E_ARTIFACT_DIR: path.join(root, ".quorumx-e2e-test") },
  });
}

describe("Velvet Solace disposable organization harness", () => {
  it("emits a redacted, deterministic manifest with every named fixture", () => {
    const result = run("manifest", "--run-id", "20261005t120000z-ab12cd");
    expect(result.status).toBe(0);
    const manifest = JSON.parse(result.stdout);
    expect(manifest).toEqual(expect.objectContaining({
      organization: expect.objectContaining({
        displayName: "Velvet Solace",
        slug: "velvet-solace-20261005t120000z-ab12cd",
        ownershipMarker: "quorumx-e2e",
      }),
      environment: "local",
    }));
    expect(Object.keys(manifest.fixtures)).toEqual([
      "mirage", "ember", "wanderlust", "eclipse", "reverie",
      "serendipity", "moonbeam", "whimsy", "afterglow", "halcyon",
    ]);
    expect(JSON.stringify(manifest)).not.toMatch(/password|private.?key|admin.?token|connection.?string/i);
  });

  it("creates a missing artifact root before provisioning a run", () => {
    const source = readFileSync(script, "utf8");
    expect(source).toContain("await mkdir(artifactRoot(), { recursive: true })");
    expect(source.indexOf("await mkdir(artifactRoot(), { recursive: true })"))
      .toBeLessThan(source.indexOf("await mkdir(runDirectory, { recursive: false })"));
  });

  it.each(["../escape", "UPPER", "", "contains space"])("rejects unsafe run id %p", (runId) => {
    const result = run("manifest", "--run-id", runId);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("invalid run id");
  });

  it("ships a complete fixture catalog whose canonical ids are run scoped", () => {
    const catalog = JSON.parse(readFileSync(path.join(root, "fixtures", "organizations", "velvet-solace.json"), "utf8"));
    expect(catalog.displayName).toBe("Velvet Solace");
    expect(catalog.proposals.map((item: { name: string }) => item.name)).toEqual([
      "Mirage", "Ember", "Wanderlust", "Eclipse", "Reverie",
      "Serendipity", "Moonbeam", "Whimsy", "Afterglow", "Halcyon",
    ]);
    expect(new Set(catalog.proposals.map((item: { fixtureId: string }) => item.fixtureId)).size).toBe(10);
  });

  it("fails closed when Docker cannot prove teardown state", () => {
    const result = spawnSync(process.execPath, [script, "verify-clean", "--run-id", "20261005t120000z-ab12cd"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        QUORUMX_E2E_ARTIFACT_DIR: path.join(root, ".quorumx-e2e-test"),
        QUORUMX_DOCKER_BIN: "quorumx-definitely-missing-docker",
      },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("docker ps failed");
  });
});
