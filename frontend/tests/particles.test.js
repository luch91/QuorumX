const {
  seededRandom,
  particleProfile,
  buildAtmosphere,
} = require("../particles.js");
const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");

describe("GPU particle core", () => {
  test("pins and stages Three.js from a local runtime module", () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));

    expect(packageJson.dependencies.three).toBe("0.186.1");
    expect(packageJson.scripts["stage:three"]).toBe("node scripts/stage_three.cjs");
    expect(existsSync(resolve(process.cwd(), "frontend/vendor/three.module.js"))).toBe(true);
  });

  test("generates stable seeded sequences with meaningful divergence", () => {
    const first = seededRandom(0x51f15e);
    const second = seededRandom(0x51f15e);
    const different = seededRandom(0x51f15f);
    const a = Array.from({ length: 8 }, () => first());

    expect(Array.from({ length: 8 }, () => second())).toEqual(a);
    expect(Array.from({ length: 8 }, () => different())).not.toEqual(a);
    expect(a.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  test.each([
    [1467, 367, 1467, 3, "reference", 24000, 18000, 5200, 2],
    [1024, 500, 1024, 1, "tablet", 18000, 13000, 4000, 1],
    [390, 420, 390, 4, "mobile", 9000, 7000, 1800, 2],
  ])("selects bounded %s px particle profiles", (width, height, viewportWidth, dpr, name, atmosphere, flow, logo, pixelRatio) => {
    expect(particleProfile(width, height, viewportWidth, dpr)).toMatchObject({
      name, atmosphereCount: atmosphere, flowCount: flow, logoCount: logo, pixelRatio,
    });
  });

  test("defers zero-sized geometry", () => {
    expect(particleProfile(0, 367, 1467, 1)).toBeNull();
    expect(particleProfile(1467, 0, 1467, 1)).toBeNull();
  });

  test("builds deterministic fine-grained atmosphere attributes", () => {
    const profile = particleProfile(1467, 367, 1467, 1);
    const first = buildAtmosphere(profile, 77);
    const second = buildAtmosphere(profile, 77);

    expect(first.positions).toBeInstanceOf(Float32Array);
    expect(first.positions).toHaveLength(profile.atmosphereCount * 3);
    expect(first.sizes).toHaveLength(profile.atmosphereCount);
    expect(first.brightness).toHaveLength(profile.atmosphereCount);
    expect([...first.positions.slice(0, 24)]).toEqual([...second.positions.slice(0, 24)]);
    expect(Math.max(...first.sizes)).toBeLessThanOrEqual(1.45);
    expect(Math.min(...first.sizes)).toBeGreaterThanOrEqual(0.349);
  });
});
