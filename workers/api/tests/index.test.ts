import { cycleOutcome } from "../src/operational";
import { secureEqual } from "../src/admin_auth";

describe("operational cycle outcome", () => {
  it.each([
    [{ sourcesPolled: 2, errors: [] }, 2, "healthy"],
    [{ sourcesPolled: 1, errors: ["snapshot:one: timeout"] }, 2, "degraded"],
    [{ sourcesPolled: 0, errors: ["snapshot:one: timeout", "snapshot:two: timeout"] }, 2, "failed"],
    [{ sourcesPolled: 1, errors: ["cycle_budget_exhausted"] }, 2, "failed"],
  ])("classifies %j as %s", (result, configured, expected) => {
    expect(cycleOutcome(result, configured)).toBe(expected);
  });
});

describe("admin authentication", () => {
  it.each([undefined, "", "short"])("fails closed for an unsafe configured token: %s", async (expected) => {
    await expect(secureEqual("", expected)).resolves.toBe(false);
  });

  it("accepts only the matching non-empty admin token", async () => {
    const token = "a".repeat(32);
    await expect(secureEqual(token, token)).resolves.toBe(true);
    await expect(secureEqual("b".repeat(32), token)).resolves.toBe(false);
  });
});
