const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const html = readFileSync(resolve(process.cwd(), "frontend/index.html"), "utf8");
const css = readFileSync(resolve(process.cwd(), "frontend/styles.css"), "utf8");

describe("responsive proposal search contract", () => {
  test("provides a labelled expandable search control and panel", () => {
    expect(html).toMatch(/data-search-toggle[^>]*aria-expanded="false"[^>]*aria-controls="mobile-search-panel"/);
    expect(html).toMatch(/id="mobile-search-panel"[^>]*data-search-panel[^>]*hidden/);
    expect(html).toMatch(/data-search-panel[\s\S]*?<input[^>]*type="search"[^>]*data-search/);
  });

  test("uses an intentional responsive search treatment instead of removing search", () => {
    expect(css).toMatch(/\.search-toggle/);
    expect(css).toMatch(/\.mobile-search-panel/);
    expect(css).toMatch(/@media \(max-width: 1100px\)[\s\S]*?\.search-toggle\s*\{\s*display:\s*grid;/);
  });
});
