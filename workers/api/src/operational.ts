export function cycleOutcome(
  result: { sourcesPolled: number; errors: string[] }, configuredSources: number,
): "healthy" | "degraded" | "failed" {
  if (result.errors.length === 0) return "healthy";
  const sourceFailures = result.errors.filter((entry) => entry.startsWith("snapshot:")
    && !entry.includes("could not record failure")).length;
  if (result.errors.includes("cycle_budget_exhausted")
    || (configuredSources > 0 && sourceFailures >= configuredSources && result.sourcesPolled === 0)) return "failed";
  return "degraded";
}
