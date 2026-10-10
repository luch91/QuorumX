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

function lines(text: string): string[] {
  return text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
}

function addressesOnLines(text: string, context: RegExp): string[] {
  return [...new Set(lines(text).filter((line) => context.test(line))
    .flatMap((line) => matches(line, /\b0x[a-fA-F0-9]{40}\b/g)))].sort();
}

function materialClaims(text: string): string[] {
  return lines(text).filter((line) => /\b(?:users?|members?|revenue|volume|funding|budget|growth|audited|no further funding|monthly active)\b|\b\d[\d,.]*(?:\s*(?:%|k|m|b|million|billion))\b/i.test(line)
      && !/\b(?:transfer|send|allocate|fund|disburse|withdraw|grant|distribute)\b/i.test(line))
    .map((line) => line.slice(0, 240)).sort();
}

function contextualLines(text: string, context: RegExp): string[] {
  return lines(text).filter((line) => { context.lastIndex = 0; return context.test(line); }).map((line) => line.slice(0, 240)).sort();
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
  const amountPattern = /\b\d[\d,]*(?:\.\d+)?\s*(?:k|m|b|million|billion)?\s*(?:ARB|BAL|SAFE|ENS|ETH|USDC|USDT|DAI)\b/gi;
  const previousAmounts = matches(before, amountPattern), currentAmounts = matches(after, amountPattern);
  add("Token amounts mentioned", previousAmounts, currentAmounts,
    "A token amount in the proposal text changed; inspect the source to confirm its role.");
  if (/\b(?:transfer|send|allocate|fund|disburse|withdraw|grant|distribute)\b/i.test(before)
      || /\b(?:transfer|send|allocate|fund|disburse|withdraw|grant|distribute)\b/i.test(after)) {
    const actionAmounts = (text: string) => lines(text)
      .filter((line) => /\b(?:transfer|send|allocate|fund|disburse|withdraw|grant|distribute)\b/i.test(line))
      .flatMap((line) => matches(line, amountPattern));
    add("Funding amount", actionAmounts(before), actionAmounts(after),
      "The amount associated with a treasury action changed in the proposal text.");
    const actionAssets = (text: string) => lines(text)
      .filter((line) => /\b(?:transfer|send|allocate|fund|disburse|withdraw|grant|distribute)\b/i.test(line))
      .flatMap((line) => matches(line, /\b(?:ARB|BAL|SAFE|ENS|ETH|USDC|USDT|DAI)\b/gi));
    add("Treasury asset", actionAssets(before), actionAssets(after),
      "The asset associated with a treasury action changed in the proposal text.");
  }
  add("Addresses mentioned", matches(before, /\b0x[a-fA-F0-9]{40}\b/g), matches(after, /\b0x[a-fA-F0-9]{40}\b/g),
    "An address reference changed; inspect whether it is a recipient, signer, or execution target.");
  add("Recipient address", addressesOnLines(before, /\b(?:transfer|send|allocate|fund|pay|recipient)\b/i),
    addressesOnLines(after, /\b(?:transfer|send|allocate|fund|pay|recipient)\b/i),
    "An address in an explicit treasury-action or recipient context changed.");
  add("Signer addresses", addressesOnLines(before, /\b(?:signers?|owners?|multisig owners)\b/i),
    addressesOnLines(after, /\b(?:signers?|owners?|multisig owners)\b/i),
    "Addresses in explicit signer/owner context changed; inspect the Safe configuration and role.");
  add("Execution target", addressesOnLines(before, /\b(?:execution target|target contract|implementation contract)\b/i),
    addressesOnLines(after, /\b(?:execution target|target contract|implementation contract)\b/i),
    "An address in explicit execution-target context changed.");
  const thresholdPattern = /\b\d+\s*(?:\/|of)\s*\d+\b/gi;
  const previousThresholds = lines(before).filter((line) => !/\b(safe|multisig|signature threshold|quorum|voting threshold|approval threshold|governance threshold)\b/i.test(line)).flatMap((line) => matches(line, thresholdPattern));
  const currentThresholds = lines(after).filter((line) => !/\b(safe|multisig|signature threshold|quorum|voting threshold|approval threshold|governance threshold)\b/i.test(line)).flatMap((line) => matches(line, thresholdPattern));
  add("Signature thresholds mentioned", matches(before, thresholdPattern), matches(after, thresholdPattern),
    "A threshold reference changed; inspect its role in the proposal.");
  add("Safe/multisig threshold", lines(before).filter((line) => /\b(safe|multisig|signature threshold)\b/i.test(line)).flatMap((line) => matches(line, thresholdPattern)),
    lines(after).filter((line) => /\b(safe|multisig|signature threshold)\b/i.test(line)).flatMap((line) => matches(line, thresholdPattern)),
    "A threshold stated in a Safe/multisig context changed.");
  add("Governance threshold", lines(before).filter((line) => /\b(quorum|voting threshold|approval threshold|governance threshold)\b/i.test(line)).flatMap((line) => matches(line, thresholdPattern)),
    lines(after).filter((line) => /\b(quorum|voting threshold|approval threshold|governance threshold)\b/i.test(line)).flatMap((line) => matches(line, thresholdPattern)),
    "A governance threshold reference changed.");
  add("Other threshold references", previousThresholds, currentThresholds, "A threshold reference changed; its role is not explicit in the text.");
  add("Program durations mentioned", matches(before, /\b\d+\s*(?:days?|weeks?|months?|years?)\b/gi),
    matches(after, /\b\d+\s*(?:days?|weeks?|months?|years?)\b/gi), "A duration reference changed.");
  for (const [field, expression] of [
    ["Clawback language", /\b(?:clawback|claw-back|recover unused funds)\b/gi],
    ["Milestone language", /\b(?:milestone|checkpoint)\b/gi],
  ] as const) {
    const oldMentions = contextualLines(before, expression), newMentions = contextualLines(after, expression);
    if (JSON.stringify(oldMentions) !== JSON.stringify(newMentions)) {
      changes.push({ field, previousValue: oldMentions.join(", ") || "Not mentioned",
        currentValue: newMentions.join(", ") || "Not mentioned", significance: "material",
        explanation: "Relevant language changed. Read both revisions before inferring a safeguard change." });
    }
  }
  add("Safeguard language", contextualLines(before, /\b(?:clawback|claw-back|recover unused funds|refund|recovery|timelock|multisig|milestone|checkpoint|spending restriction)\b/i),
    contextualLines(after, /\b(?:clawback|claw-back|recover unused funds|refund|recovery|timelock|multisig|milestone|checkpoint|spending restriction)\b/i),
    "Safeguard language changed; the review distinguishes explicit absence from material not identified.");
  add("Material claim text", materialClaims(before), materialClaims(after),
    "A measurable or factual claim changed between revisions; this text comparison does not independently verify either claim.");
  add("Permission holder", contextualLines(before, /\b(?:grant|assign|transfer)\b.{0,60}\b(?:permission|role|admin|owner)\b|\b(?:permission|role|admin|owner)\b.{0,60}\b(?:to|holder)\b/i),
    contextualLines(after, /\b(?:grant|assign|transfer)\b.{0,60}\b(?:permission|role|admin|owner)\b|\b(?:permission|role|admin|owner)\b.{0,60}\b(?:to|holder)\b/i),
    "The text identifying a permission or role holder changed; inspect both revisions to confirm the exact control effect.");
  add("Audit/reference", contextualLines(before, /\b(?:audit|security review|report|repository|github|reference)\b/i),
    contextualLines(after, /\b(?:audit|security review|report|repository|github|reference)\b/i),
    "An audit or supporting-reference line changed; this comparison does not validate the referenced material.");
  if (before !== after && changes.every((change) => change.field === "Title")) {
    changes.push({ field: "Proposal body", significance: "minor", explanation: "Text changed outside the tracked material fields; compare the original revisions." });
  }
  return changes;
}
