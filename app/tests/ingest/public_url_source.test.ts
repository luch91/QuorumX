import { validatePublicProposalUrl } from "../../src/ingest/sources/public_url_source";

describe("public proposal URL policy", () => {
  const publicResolver = async () => ["93.184.216.34"];

  it.each([
    "http://example.org/proposal",
    "https://user:pass@example.org/proposal",
    "https://localhost/proposal",
    "https://127.0.0.1/proposal",
    "https://169.254.1.1/proposal",
    "https://10.0.0.1/proposal",
    "https://172.16.0.1/proposal",
    "https://192.168.1.1/proposal",
    "https://[::1]/proposal",
    "https://[fc00::1]/proposal",
    "https://[fe80::1]/proposal",
  ])("rejects unsafe URL %s", async (url) => {
    await expect(validatePublicProposalUrl(url, publicResolver)).rejects.toThrow();
  });

  it("rejects a public hostname resolving to a private address", async () => {
    await expect(validatePublicProposalUrl("https://example.org/proposal", async () => ["10.0.0.2"]))
      .rejects.toThrow("private or reserved address");
  });

  it("accepts an HTTPS hostname resolving only to public addresses", async () => {
    await expect(validatePublicProposalUrl("https://example.org/proposal", publicResolver))
      .resolves.toEqual(new URL("https://example.org/proposal"));
  });
});
