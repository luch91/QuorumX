const { readFileSync, statSync } = require("node:fs");
const { resolve } = require("node:path");

function source(path) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Three.js particle renderer integration", () => {
  test("ships a self-contained renderer bundle within the cold-start budget", () => {
    const bundlePath = resolve(process.cwd(), "frontend/particle_renderer.bundle.js");
    const bundle = readFileSync(bundlePath, "utf8");

    expect(statSync(bundlePath).size).toBeLessThan(550_000);
    expect(bundle).not.toMatch(/from\s+["']\.\/vendor\/three/);
  });

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
    expect(html).toMatch(/rel="modulepreload" href="particle_renderer\.bundle\.js"/);
    expect(html).toMatch(/id="dao-particles"[\s\S]*?id="dao-particles-gpu"/);
    expect(html).not.toMatch(/modulepreload[^>]+vendor\/three/);
    expect(app).toContain('import("./particle_renderer.bundle.js")');
    expect(app.indexOf('import("./particle_renderer.bundle.js")')).toBeLessThan(app.indexOf("Promise.all(marks.map(loadParticleMask))"));
    expect(app).toMatch(/webgl-ready/);
    expect(app).toMatch(/webgl-failed/);
    expect(app).toContain('performance.mark?.("quorumx-particles-ready")');
    expect(app).not.toMatch(/function sampleLogo/);
    expect(css).toMatch(/\.particle-stage\.webgl-ready/);
    expect(html).toMatch(/particle-stage webgl-loading/);
    expect(css).toMatch(/#dao-particles \{[^}]*opacity: 0/);
    expect(css).toMatch(/\.particle-stage\.webgl-loading #dao-particles \{ opacity: 1; \}/);
    expect(css).toMatch(/\.particle-stage\.webgl-failed #dao-particles \{ opacity: 1; \}/);
    expect(app).toMatch(/stage\?\.classList\.contains\("webgl-failed"\) \? logoParticles : \[\]/);
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
    expect(css).toMatch(/span:nth-child\(1\) \{ left: var\(--dao-1-x,9%\); \}/);
    expect(css).toMatch(/span:nth-child\(4\) \{ left: var\(--dao-4-x,81%\); \}/);
    expect(css).toMatch(/top: var\(--dao-label-top,60%\)/);
  });

  test("rebuilds GPU geometry when a live resize crosses a responsive profile boundary", () => {
    const app = source("frontend/app.js");

    expect(app).toMatch(/nextProfile\.renderKey !== activeRenderKey/);
    expect(app).toMatch(/renderer\.dispose\(\)[\s\S]*?mountRenderer\(nextProfile\)/);
  });

  test("bounds only tablet and mobile hero dimensions while preserving desktop geometry", () => {
    const css = source("frontend/styles.css");

    expect(css).toMatch(/@media \(min-width: 1101px\)[\s\S]*?\.hero \{ height: 299px; min-height: 299px; grid-template-columns: 34% 66%; \}/);
    expect(css).toMatch(/@media \(min-width: 1101px\)[\s\S]*?\.hero h1 \{ font-size: clamp\(36px,2\.73vw,40px\);/);
    expect(css).toMatch(/\.hero-actions \.button \{ white-space: nowrap; flex-shrink: 0; \}/);
    expect(css).toMatch(/@media \(min-width: 821px\) and \(max-width: 1100px\)[\s\S]*?\.hero \{ height: clamp\(360px, 46vw, 440px\); min-height: 360px;/);
    expect(css).toMatch(/@media \(max-width: 820px\)[\s\S]*?\.particle-stage \{ height: clamp\(270px, 52vw, 330px\); min-height: 270px;/);
    expect(css).toMatch(/@media \(max-width: 580px\)[\s\S]*?\.hero-actions \{ flex-wrap: wrap;/);
  });
});
