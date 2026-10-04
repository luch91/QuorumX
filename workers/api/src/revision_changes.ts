export interface ProposalChange {
  field: string;
  previousValue?: string;
  currentValue?: string;
  significance: "minor" | "material";
  explanation: string;
}

interface RevisionMaterial {
  title?: string;
  bodyText?: string;
  choices?: string[];
}

function matches(text: string, expression: RegExp): string[] {
  return [...new Set((text.match(expression) ?? []).map((item) => item.replace(/\s+/g, " ").trim()))].sort();
}

export function revisionChanges(previous?: RevisionMaterial, current?: RevisionMaterial): ProposalChange[] {
  if (!previous || !current) return [];
  const changes: ProposalChange[] = [];
  const add = (field: string, before: string[], after: string[], explanation: string) => {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    changes.push({ field, previousValue: before.join(", ") || "Not found", currentValue: after.join(", ") || "Not found",
      significance: "material", explanation });
  };
  if (previous.title !== current.title) changes.push({ field: "Title", previousValue: previous.title,
    currentValue: current.title, significance: "minor", explanation: "Proposal title changed." });
  if (JSON.stringify(previous.choices ?? []) !== JSON.stringify(current.choices ?? [])) {
    add("Voting choices", previous.choices ?? [], current.choices ?? [], "The available voting choices changed.");
  }
  const before = previous.bodyText ?? "", after = current.bodyText ?? "";
  add("Token amounts mentioned", matches(before, /\b\d[\d,]*(?:\.\d+)?\s*(?:ARB|BAL|SAFE|ENS|ETH|USDC|USDT|DAI)\b/gi),
    matches(after, /\b\d[\d,]*(?:\.\d+)?\s*(?:ARB|BAL|SAFE|ENS|ETH|USDC|USDT|DAI)\b/gi),
    "A token amount in the proposal text changed; inspect the source to confirm its role.");
  add("Addresses mentioned", matches(before, /\b0x[a-fA-F0-9]{40}\b/g), matches(after, /\b0x[a-fA-F0-9]{40}\b/g),
    "An address reference changed; inspect whether it is a recipient, signer, or execution target.");
  add("Signature thresholds mentioned", matches(before, /\b\d+\s*(?:\/|of)\s*\d+\b/gi),
    matches(after, /\b\d+\s*(?:\/|of)\s*\d+\b/gi), "A threshold reference changed.");
  add("Program durations mentioned", matches(before, /\b\d+\s*(?:days?|weeks?|months?|years?)\b/gi),
    matches(after, /\b\d+\s*(?:days?|weeks?|months?|years?)\b/gi), "A duration reference changed.");
  for (const [field, expression] of [
    ["Clawback language", /\b(?:clawback|claw-back|recover unused funds)\b/gi],
    ["Milestone language", /\b(?:milestone|checkpoint)\b/gi],
  ] as const) {
    const oldMentions = matches(before, expression), newMentions = matches(after, expression);
    if (JSON.stringify(oldMentions) !== JSON.stringify(newMentions)) {
      changes.push({ field, previousValue: oldMentions.join(", ") || "Not mentioned",
        currentValue: newMentions.join(", ") || "Not mentioned", significance: "material",
        explanation: "This term was added or removed. Read both revisions before inferring a safeguard change." });
    }
  }
  if (before !== after && changes.every((change) => change.field === "Title")) {
    changes.push({ field: "Proposal body", significance: "minor", explanation: "Text changed outside the tracked material fields; compare the original revisions." });
  }
  return changes;
}
