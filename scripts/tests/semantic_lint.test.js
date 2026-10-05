const { acceptsKnownUpstreamFailure } = require("../verify_semantic_lint.cjs");

const allowed = { diagnostics: [{ code: "E101", message: "HTTP Error 404: Not Found while downloading the GenVM release asset" }] };

describe("semantic lint fail-closed parser", () => {
  test("accepts only the exact known upstream diagnostic", () => expect(acceptsKnownUpstreamFailure(JSON.stringify(allowed))).toBe(true));
  test.each([
    "not json",
    JSON.stringify({ diagnostics: [] }),
    JSON.stringify({ diagnostics: [{ code: "E102", message: allowed.diagnostics[0].message }] }),
    JSON.stringify({ diagnostics: [{ code: "E101", message: "HTTP Error 404" }] }),
    JSON.stringify({ diagnostics: [...allowed.diagnostics, { code: "E999", message: "another error" }] }),
  ])("rejects malformed, changed, empty, or additional diagnostics", (value) => expect(acceptsKnownUpstreamFailure(value)).toBe(false));
});
