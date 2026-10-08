const {
  seededRandom,
  particleProfile,
  buildAtmosphere,
  normalizeMaskPixels,
  sampleLogoMask,
  resolveParticleMasks,
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

  test("normalizes source pixels and assigns extra weight to sharp edges", () => {
    const data = new Uint8ClampedArray(5 * 5 * 4);
    for (let y = 1; y < 4; y += 1) for (let x = 1; x < 4; x += 1) {
      const offset = (y * 5 + x) * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = 255;
      data[offset + 3] = 255;
    }

    const mask = normalizeMaskPixels({ data, width: 5, height: 5 }, "light");

    expect(mask.weights[2 * 5 + 2]).toBeGreaterThan(0);
    expect(mask.edges[1 * 5 + 1]).toBeGreaterThan(mask.edges[2 * 5 + 2]);
    expect(mask.weights[0]).toBe(0);
  });

  test("samples deterministic dense logo buffers at final normalized positions", () => {
    const data = new Uint8ClampedArray(8 * 8 * 4).fill(255);
    const mask = normalizeMaskPixels({ data, width: 8, height: 8 }, "light");
    const profile = { ...particleProfile(390, 420, 390, 2), logoCount: 120 };
    const first = sampleLogoMask(mask, profile, 41);
    const second = sampleLogoMask(mask, profile, 41);

    expect(first.positions).toHaveLength(360);
    expect(first.targets).toBe(first.positions);
    expect([...first.positions]).toEqual([...second.positions]);
    expect(first.brightness).toHaveLength(120);
    expect(Math.max(...first.sizes)).toBeLessThanOrEqual(1.7);
  });

  test("resolves mixed malformed masks independently and preserves four identities", () => {
    const valid = normalizeMaskPixels({ data: new Uint8ClampedArray(4 * 4 * 4).fill(255), width: 4, height: 4 }, "light");
    const masks = resolveParticleMasks([valid, null, { width: 0 }, valid]);

    expect(masks).toHaveLength(4);
    expect(masks[0].weights).toBe(valid.weights);
    expect(masks[3].weights).toBe(valid.weights);
    expect(masks[1].source).toBe("procedural");
    expect(masks[2].source).toBe("procedural");
    expect(new Set(masks.map((mask) => mask.identity)).size).toBe(4);
  });
});
