(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.QuorumXParticles = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function seededRandom(seed) {
    let state = seed >>> 0;
    return function random() {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }

  function particleProfile(width, height, viewportWidth = width, dpr = 1) {
    if (!(width > 0) || !(height > 0)) return null;
    const pixelRatio = Number.isFinite(dpr) && dpr > 0 ? Math.min(dpr, 2) : 1;
    if (viewportWidth >= 1100) return {
      name: "reference", width, height, pixelRatio,
      atmosphereCount: 24000, flowCount: 18000, logoCount: 5200,
      pointSize: [0.35, 1.45], seed: 0x51f15e,
    };
    if (viewportWidth >= 820) return {
      name: "tablet", width, height, pixelRatio,
      atmosphereCount: 18000, flowCount: 13000, logoCount: 4000,
      pointSize: [0.35, 1.35], seed: 0x51f15e,
    };
    return {
      name: "mobile", width, height, pixelRatio,
      atmosphereCount: 9000, flowCount: 7000, logoCount: 1800,
      pointSize: [0.35, 1.2], seed: 0x51f15e,
    };
  }

  function gaussian(random) {
    return Math.sqrt(-2 * Math.log(Math.max(random(), 1e-7))) * Math.cos(Math.PI * 2 * random());
  }

  function buildAtmosphere(profile, seed = profile.seed) {
    const random = seededRandom(seed);
    const count = profile.atmosphereCount;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const brightness = new Float32Array(count);
    const phases = new Float32Array(count);
    const [minimumSize, maximumSize] = profile.pointSize;
    for (let index = 0; index < count; index += 1) {
      const offset = index * 3;
      const x = random() * 2 - 1;
      const envelope = Math.sin((x + 1) * 3.7) * 0.08 + Math.sin((x + 1) * 8.4) * 0.035;
      const depth = random();
      positions[offset] = x;
      positions[offset + 1] = envelope + gaussian(random) * (0.22 + depth * 0.08);
      positions[offset + 2] = depth * 2 - 1;
      sizes[index] = minimumSize + (maximumSize - minimumSize) * Math.pow(random(), 2.1);
      brightness[index] = 0.22 + Math.pow(random(), 1.7) * 0.78;
      phases[index] = random() * Math.PI * 2;
    }
    return { positions, sizes, brightness, phases };
  }

  return { seededRandom, particleProfile, buildAtmosphere };
});
