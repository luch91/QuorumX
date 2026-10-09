export interface SnapshotSourceDefinition {
  kind: "snapshot";
  space: string;
  displayName: string;
  homepageUrl: string;
  logoUrl: string;
  readonly ecosystems: readonly string[];
  assessmentEnabled: boolean;
  dailyAssessmentBudget: number;
}

const definitions = [
  {
    kind: "snapshot",
    space: "balancer.eth",
    displayName: "Balancer",
    homepageUrl: "https://vote.balancer.fi",
    logoUrl: "https://cdn.stamp.fyi/space/balancer.eth?s=160",
    ecosystems: ["defi", "ethereum"],
    assessmentEnabled: true,
    dailyAssessmentBudget: 2,
  },
  {
    kind: "snapshot",
    space: "safe.eth",
    displayName: "SafeDAO",
    homepageUrl: "https://forum.safe.global",
    logoUrl: "https://cdn.stamp.fyi/space/safe.eth?s=160",
    ecosystems: ["ethereum", "infrastructure", "smart-accounts"],
    assessmentEnabled: true,
    dailyAssessmentBudget: 1,
  },
  {
    kind: "snapshot",
    space: "arbitrumfoundation.eth",
    displayName: "Arbitrum DAO",
    homepageUrl: "https://forum.arbitrum.foundation",
    logoUrl: "https://cdn.stamp.fyi/space/arbitrumfoundation.eth?s=160",
    ecosystems: ["arbitrum", "ethereum", "layer-2"],
    assessmentEnabled: true,
    dailyAssessmentBudget: 1,
  },
  {
    kind: "snapshot",
    space: "ens.eth",
    displayName: "ENS DAO",
    homepageUrl: "https://discuss.ens.domains",
    logoUrl: "https://cdn.stamp.fyi/space/ens.eth?s=160",
    ecosystems: ["ens", "ethereum", "identity"],
    assessmentEnabled: true,
    dailyAssessmentBudget: 1,
  },
] as const satisfies readonly SnapshotSourceDefinition[];

const bySpace = new Map<string, SnapshotSourceDefinition>(
  definitions.map((definition) => [definition.space, definition]),
);

export const snapshotSourceDefinitions: readonly SnapshotSourceDefinition[] = definitions;

const requiredCoverageSpaces = ["safe.eth", "arbitrumfoundation.eth", "ens.eth"] as const;

export function validateMultiDaoCoverage(spaces: string[]): void {
  const configured = new Set(spaces.map((space) => space.trim().toLowerCase()));
  const missing = requiredCoverageSpaces.filter((space) => !configured.has(space));
  if (missing.length > 0) throw new Error(`Snapshot coverage is missing required spaces: ${missing.join(", ")}`);
}

export function snapshotSourceForSpace(space: string): SnapshotSourceDefinition {
  const normalized = space.trim().toLowerCase();
  const definition = bySpace.get(normalized);
  if (!definition) throw new Error(`Snapshot space is not registered: ${normalized}`);
  return definition;
}
