import { GenLayerGatewayImpl } from "../../src/genlayer/gateway";
import type { GenLayerClientPort } from "../../src/genlayer/types";

const address = "0x1111111111111111111111111111111111111111" as const;
const source = { kind: "snapshot", space: "gen.eth", proposalId: "p-1" } as const;

function client(overrides: Partial<GenLayerClientPort> = {}): GenLayerClientPort {
  return {
    writeContract: jest.fn().mockResolvedValue("0xtx"),
    waitForTransactionReceipt: jest.fn().mockResolvedValue({ statusName: "ACCEPTED", txExecutionResultName: "FINISHED_WITH_RETURN" }),
    readContract: jest.fn().mockResolvedValue(""),
    ...overrides,
  };
}

describe("GenLayerGatewayImpl", () => {
  it("serializes source and calls assess", async () => {
    const port = client();
    const gateway = new GenLayerGatewayImpl(port, address);
    await expect(gateway.submitAssessment(source, "idem-1")).resolves.toBe("0xtx");
    expect(port.writeContract).toHaveBeenCalledWith({
      address, functionName: "assess", args: [JSON.stringify(source), "idem-1"], value: 0n,
    });
  });

  it.each([
    [{ statusName: "UNDETERMINED" }, "undetermined"],
    [{ statusName: "REVERTED", error: "no consensus" }, "reverted"],
  ] as const)("maps lifecycle %#", async (receipt, state) => {
    const gateway = new GenLayerGatewayImpl(client({ waitForTransactionReceipt: jest.fn().mockResolvedValue(receipt) }), address);
    await expect(gateway.waitForAssessment("0xtx", "snapshot:gen.eth:p-1")).resolves.toMatchObject({ state });
  });

  it("maps wait failures without resubmitting", async () => {
    const port = client({ waitForTransactionReceipt: jest.fn().mockRejectedValue(new Error("timeout")) });
    const result = await new GenLayerGatewayImpl(port, address).waitForAssessment("0xtx", "proposal");
    expect(result).toMatchObject({ state: "undetermined", error: "timeout" });
    expect(port.writeContract).not.toHaveBeenCalled();
  });

  it("decodes an accepted assessment and preserves fixture provenance", async () => {
    const raw = JSON.stringify({ proposal_key: "fixture:archived", locator_hash: "source", content_hash: "content", risk_level: "high", score: 88, categories: ["governance"], recommendation: "manual_review", summary: "Review", assessed_at: "2026-09-28T00:00:00Z", source_kind: "fixture" });
    const gateway = new GenLayerGatewayImpl(client({ readContract: jest.fn().mockResolvedValue(raw) }), address);
    await expect(gateway.getAssessment("fixture:archived")).resolves.toMatchObject({ riskScore: 88, provenance: "fixture" });
  });

  it("rejects malformed contract responses", async () => {
    const gateway = new GenLayerGatewayImpl(client({ readContract: jest.fn().mockResolvedValue('{"score": 101}') }), address);
    await expect(gateway.getAssessment("proposal")).rejects.toThrow();
  });
});
