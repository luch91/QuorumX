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
    expect(html).toMatch(/rel="modulepreload" href="particle_renderer\.js"/);
    expect(html).toMatch(/id="dao-particles"[\s\S]*?id="dao-particles-gpu"/);
    expect(html).toContain('<link rel="modulepreload" href="vendor/three.module.js">');
    expect(html).toContain('<link rel="modulepreload" href="vendor/three.core.js">');
    expect(app).toContain('import("./particle_renderer.js")');
    expect(app.indexOf('import("./particle_renderer.js")')).toBeLessThan(app.indexOf("Promise.all(marks.map(loadParticleMask))"));
    expect(app).toMatch(/webgl-ready/);
    expect(app).toMatch(/webgl-failed/);
    expect(app).toContain('performance.mark?.("quorumx-particles-ready")');
    expect(app).not.toMatch(/function sampleLogo/);
    expect(css).toMatch(/\.particle-stage\.webgl-ready/);
    expect(css).toMatch(/#dao-particles \{[^}]*opacity: 0/);
    expect(css).toMatch(/\.particle-stage\.webgl-failed #dao-particles \{ opacity: 1; \}/);
  });

  test("uses the final logo geometry for both sharp particles and concentrated glow", () => {
    const renderer = source("frontend/particle_renderer.js");

    expect(renderer).toMatch(/new THREE\.Points\(logoGeometry, logoGlowMaterial\)/);
    expect(renderer).toMatch(/new THREE\.Points\(attributes\(logoGeometry,[\s\S]*?\), logoMaterial\)/);
  });

  test("orbits the surrounding flow while keeping the logo core stable in a reference-height hero", () => {
    const renderer = source("frontend/particle_renderer.js");
    const css = source("frontend/styles.css");

    expect(renderer).toMatch(/uHover/);
    expect(renderer).toMatch(/flowMaterial[\s\S]*?hover: 1/);
    expect(renderer).toMatch(/uAssembly/);
    expect(renderer).toMatch(/aOrigin/);
    expect(css).toMatch(/height: 299px; min-height: 299px/);
    expect(css).toMatch(/#dao-particles, #dao-particles-gpu \{ height: 100%; \}/);
    expect(css).toMatch(/span:nth-child\(1\) \{ left: 9%; \}/);
    expect(css).toMatch(/span:nth-child\(4\) \{ left: 81%; \}/);
    expect(css).toMatch(/\.particle-labels \{ top: 60%;/);
  });
});
