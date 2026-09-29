import { canonicalJson, contractCanonicalJson, sha256 } from "../src/canonical";

describe("canonical serialization", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalJson({ z: 1, nested: { y: 2, a: 3 }, a: 4 }))
      .toBe('{"a":4,"nested":{"a":3,"y":2},"z":1}');
  });

  it("matches the contract's Python ensure_ascii serialization", async () => {
    const value = {
      id: "p1",
      space: "balancer.eth",
      title: "Café 🚀",
      body: "Δ",
      choices: ["Sí"],
      state: "active",
    };
    expect(contractCanonicalJson(value)).toBe(
      '{"body":"\\u0394","choices":["S\\u00ed"],"id":"p1","space":"balancer.eth","state":"active","title":"Caf\\u00e9 \\ud83d\\ude80"}',
    );
    expect(await sha256(contractCanonicalJson(value)))
      .toBe("ba38419a720665e84a113a6ec2136a4e685167eff2d841a89560ee68112d60d4");
  });
});
