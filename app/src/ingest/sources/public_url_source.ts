import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { canonicalProposalId, type GovernanceProposal, type ProposalSource } from "../../domain/governance_proposal";
import { ProposalSourceError, type ProposalSourceAdapter } from "../proposal_source";

export type HostResolver = (hostname: string) => Promise<string[]>;

async function defaultResolver(hostname: string): Promise<string[]> {
  return (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
}

function isPrivateAddress(input: string): boolean {
  const address = input.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || a >= 224;
  }
  if (isIP(address) === 6) {
    return address === "::" || address === "::1" || address.startsWith("fc") || address.startsWith("fd") ||
      address.startsWith("fe8") || address.startsWith("fe9") || address.startsWith("fea") || address.startsWith("feb");
  }
  return false;
}

export async function validatePublicProposalUrl(raw: string, resolver: HostResolver = defaultResolver): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new ProposalSourceError("Proposal URL is invalid", "unsafe_url"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hostname.toLowerCase() === "localhost") {
    throw new ProposalSourceError("Proposal URL must be public HTTPS without credentials", "unsafe_url");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname) ? [hostname] : await resolver(hostname);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new ProposalSourceError("Proposal URL resolves to a private or reserved address", "unsafe_url");
  }
  return url;
}

export class PublicUrlProposalSource implements ProposalSourceAdapter {
  readonly kind = "public_url" as const;
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly resolver: HostResolver = defaultResolver) {}
  async listEligible(): Promise<GovernanceProposal[]> { return []; }
  async get(reference: ProposalSource): Promise<GovernanceProposal> {
    if (reference.kind !== "public_url") throw new ProposalSourceError("Public URL source requires a URL reference", "invalid_reference");
    const url = await validatePublicProposalUrl(reference.url, this.resolver);
    const response = await this.fetcher(url, { redirect: "error" });
    if (!response.ok) throw new ProposalSourceError(`Proposal page failed: HTTP ${response.status}`, "unavailable");
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/") && !contentType.includes("application/json")) throw new ProposalSourceError("Proposal page content type is unsupported", "invalid_response");
    const body = (await response.text()).slice(0, 1_000_000);
    const source: ProposalSource = { kind: "public_url", url: url.toString() };
    return { canonicalId: canonicalProposalId(source), source, title: url.hostname, bodyText: body, choices: [], linkedEvidenceUrls: [], status: "unknown" };
  }
}
