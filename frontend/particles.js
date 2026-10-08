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
    if (viewportWidth > 1100) return {
      name: "reference", width, height, pixelRatio,
      atmosphereCount: 60000, flowCount: 46000, logoCount: 3600,
      pointSize: [0.35, 1.45], seed: 0x51f15e,
    };
    if (viewportWidth > 820) return {
      name: "tablet", width, height, pixelRatio,
      atmosphereCount: 38000, flowCount: 30000, logoCount: 2800,
      pointSize: [0.35, 1.35], seed: 0x51f15e,
    };
    return {
      name: "mobile", width, height, pixelRatio,
      atmosphereCount: 18000, flowCount: 14000, logoCount: 1800,
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
      positions[offset + 1] = .14 + envelope + gaussian(random) * (0.29 + depth * 0.11);
      positions[offset + 2] = depth * 2 - 1;
      const spark = random() > .965;
      sizes[index] = spark ? 1.8 + random() : minimumSize + (maximumSize - minimumSize) * Math.pow(random(), 2.1);
      brightness[index] = spark ? .82 + random() * .18 : .12 + Math.pow(random(), 1.7) * .88;
      phases[index] = random() * Math.PI * 2;
    }
    return { positions, sizes, brightness, phases };
  }

  function normalizeMaskPixels(imageData, mode = "light") {
    const { data, width, height } = imageData || {};
    if (!data || !(width > 0) || !(height > 0) || data.length < width * height * 4) return null;
    const weights = new Float32Array(width * height);
    const edges = new Float32Array(width * height);
    for (let index = 0; index < weights.length; index += 1) {
      const offset = index * 4;
      const alpha = data[offset + 3] / 255;
      const red = data[offset] / 255, green = data[offset + 1] / 255, blue = data[offset + 2] / 255;
      const luminance = red * .2126 + green * .7152 + blue * .0722;
      const distanceFromWhite = Math.sqrt((1 - red) ** 2 + (1 - green) ** 2 + (1 - blue) ** 2) / Math.sqrt(3);
      let signal;
      if (mode === "safe") signal = luminance < .24 ? 1 - luminance : 0;
      else if (mode === "arbitrum") {
        const x = index % width, y = Math.floor(index / width);
        const radius = Math.hypot(x + .5 - width / 2, y + .5 - height / 2);
        const innerRadius = Math.min(width, height) * .37;
        const glyphRadius = Math.min(width, height) * .47;
        const blueGlyph = radius < glyphRadius && blue > .52 && luminance > .34
          && blue - red > .07 && blue - green > .02;
        const whiteGlyph = radius < innerRadius && luminance > .82;
        if (width < 4) signal = distanceFromWhite > .16 ? Math.max(distanceFromWhite, .72) : 0;
        else if (whiteGlyph) signal = luminance;
        else signal = blueGlyph && distanceFromWhite > .16 ? Math.max(distanceFromWhite, .72) : 0;
      } else if (mode === "ens") signal = distanceFromWhite > .16 ? distanceFromWhite : 0;
      else signal = mode === "dark" ? 1 - luminance : luminance;
      weights[index] = alpha > .04 && signal > .12 ? alpha * signal : 0;
    }
    if (mode === "arbitrum" && width >= 32 && height >= 32) {
      const vertices = [[.5, .05], [.9, .28], [.9, .72], [.5, .94], [.1, .72], [.1, .28], [.5, .05]]
        .map(([x, y]) => [x * width, y * height]);
      const thickness = Math.min(width, height) * .035;
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        let distance = Infinity;
        for (let segment = 0; segment < vertices.length - 1; segment += 1) {
          const [x1, y1] = vertices[segment], [x2, y2] = vertices[segment + 1];
          const dx = x2 - x1, dy = y2 - y1;
          const ratio = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
          distance = Math.min(distance, Math.hypot(x - (x1 + ratio * dx), y - (y1 + ratio * dy)));
        }
        if (distance <= thickness) weights[y * width + x] = Math.max(weights[y * width + x], .78);
      }
    }
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!weights[index]) continue;
      const left = x ? weights[index - 1] : 0;
      const right = x + 1 < width ? weights[index + 1] : 0;
      const top = y ? weights[index - width] : 0;
      const bottom = y + 1 < height ? weights[index + width] : 0;
      edges[index] = Math.max(
        Math.abs(weights[index] - left), Math.abs(weights[index] - right),
        Math.abs(weights[index] - top), Math.abs(weights[index] - bottom),
      );
    }
    return { width, height, weights, edges, source: "sampled" };
  }

  function proceduralMask(identity) {
    const width = 48, height = 48;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const nx = (x - 23.5) / 23.5, ny = (y - 23.5) / 23.5;
      let mark = false;
      if (identity === 0) {
        mark = [-.5, 0, .5].some((center, index) => {
          const radiusX = [.72, .58, .82][index], radiusY = .14;
          const ring = (nx / radiusX) ** 2 + ((ny - center) / radiusY) ** 2;
          return ring > .55 && ring < 1.25;
        });
      } else if (identity === 1) {
        mark = (Math.abs(ny + .42) < .11 && nx < .35) || (Math.abs(ny) < .11 && Math.abs(nx) < .58)
          || (Math.abs(ny - .42) < .11 && nx > -.35) || (Math.abs(nx + .58) < .1 && ny < 0)
          || (Math.abs(nx - .58) < .1 && ny > 0);
      } else if (identity === 2) {
        const hex = Math.max(Math.abs(nx) * .86 + Math.abs(ny) * .5, Math.abs(ny));
        mark = (hex > .72 && hex < .9) || (Math.abs(nx + ny * .42) < .11 && Math.abs(ny) < .62)
          || (Math.abs(nx - .22 + ny * .38) < .09 && Math.abs(ny) < .55);
      } else {
        const side = Math.abs(Math.abs(nx) - (.25 + .42 * Math.sin((ny + 1) * Math.PI / 2)));
        mark = side < .09 && Math.abs(ny) < .88;
      }
      if (mark) {
        const offset = (y * width + x) * 4;
        data[offset] = data[offset + 1] = data[offset + 2] = data[offset + 3] = 255;
      }
    }
    return { ...normalizeMaskPixels({ data, width, height }, "light"), source: "procedural", identity };
  }

  function validMask(mask) {
    return mask && mask.width > 0 && mask.height > 0 && mask.weights?.length === mask.width * mask.height
      && mask.edges?.length === mask.weights.length && mask.weights.some((weight) => weight > 0);
  }

  function resolveParticleMasks(sampledMasks) {
    return [0, 1, 2, 3].map((identity) => {
      const mask = sampledMasks?.[identity];
      return validMask(mask) ? { ...mask, identity } : proceduralMask(identity);
    });
  }

  function sampleLogoMask(mask, profile, seed) {
    if (!validMask(mask)) throw new TypeError("A non-empty normalized logo mask is required");
    const random = seededRandom(seed);
    const candidates = [];
    let totalWeight = 0;
    for (let index = 0; index < mask.weights.length; index += 1) {
      const weight = mask.weights[index] * .72 + mask.edges[index] * 6.5;
      if (!weight) continue;
      totalWeight += weight;
      candidates.push({ index, cumulative: totalWeight, weight });
    }
    const count = profile.logoCount;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const brightness = new Float32Array(count);
    const phases = new Float32Array(count);
    for (let particle = 0; particle < count; particle += 1) {
      const pick = random() * totalWeight;
      let low = 0, high = candidates.length - 1;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (candidates[middle].cumulative < pick) low = middle + 1; else high = middle;
      }
      const candidate = candidates[low];
      const x = candidate.index % mask.width, y = Math.floor(candidate.index / mask.width);
      const offset = particle * 3;
      positions[offset] = ((x + random()) / mask.width - .5) * 2;
      positions[offset + 1] = (.5 - (y + random()) / mask.height) * 2;
      positions[offset + 2] = random() * .24 - .12;
      const edge = mask.edges[candidate.index];
      sizes[particle] = .42 + random() * 1.08 + edge * .18;
      brightness[particle] = Math.min(1, .62 + mask.weights[candidate.index] * .2 + edge * .45);
      phases[particle] = random() * Math.PI * 2;
    }
    return { positions, targets: positions, sizes, brightness, phases };
  }

  function swooshOrigin(targetX, targetY, phase, logoIndex) {
    return {
      x: targetX - .32 - logoIndex * .06 + Math.cos(phase) * .11,
      y: targetY + Math.sin(phase) * .24 + (logoIndex % 2 ? .035 : -.035),
    };
  }

  return {
    seededRandom, particleProfile, buildAtmosphere,
    normalizeMaskPixels, sampleLogoMask, resolveParticleMasks, swooshOrigin,
  };
});
