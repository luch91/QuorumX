import { cycleOutcome } from "../src/operational";

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
