const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

function source(path) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Three.js particle renderer integration", () => {
  test("imports only the staged local Three.js module and defines three GPU layers", () => {
    const renderer = source("frontend/particle_renderer.js");

    expect(renderer).toContain('from "./vendor/three.module.js"');
    expect(renderer).not.toMatch(/https?:\/\//);
    expect(renderer).toMatch(/atmosphere/);
    expect(renderer).toMatch(/flow/);
    expect(renderer).toMatch(/logos/);
    expect(renderer.match(/new THREE\.BufferGeometry/g)).toHaveLength(3);
  });

  test("owns bounded render lifecycle and context failure behavior", () => {
    const renderer = source("frontend/particle_renderer.js");

    expect(renderer).toMatch(/visibilitychange/);
    expect(renderer).toMatch(/webglcontextlost/);
    expect(renderer).toMatch(/webglcontextrestored/);
    expect(renderer).toMatch(/cancelAnimationFrame/);
    expect(renderer).toMatch(/\.dispose\(\)/);
    expect(renderer).toMatch(/reducedMotion/);
  });

  test("keeps a complete Canvas fallback until the first GPU frame is ready", () => {
    const html = source("frontend/index.html");
    const app = source("frontend/app.js");
    const css = source("frontend/styles.css");

    expect(html).toMatch(/particles\.js[\s\S]*?app\.js/);
    expect(html).toMatch(/id="dao-particles"[\s\S]*?id="dao-particles-gpu"/);
    expect(app).toContain('import("./particle_renderer.js")');
    expect(app).toMatch(/webgl-ready/);
    expect(app).not.toMatch(/function sampleLogo/);
    expect(css).toMatch(/\.particle-stage\.webgl-ready/);
  });

  test("uses the final logo geometry for both sharp particles and concentrated glow", () => {
    const renderer = source("frontend/particle_renderer.js");

    expect(renderer).toMatch(/new THREE\.Points\(logoGeometry, logoGlowMaterial\)/);
    expect(renderer).toMatch(/new THREE\.Points\(attributes\(logoGeometry,[\s\S]*?\), logoMaterial\)/);
  });
});
