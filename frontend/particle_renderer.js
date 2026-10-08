import * as THREE from "./vendor/three.module.js";

const vertexShader = `
attribute float aSize;
attribute float aBrightness;
attribute float aPhase;
uniform float uTime;
uniform float uMotion;
uniform float uPixelRatio;
uniform float uPointScale;
uniform float uHover;
varying float vBrightness;
void main() {
  vec3 transformed = position;
  float orbit = uTime * .00016 + aPhase;
  transformed.x += (sin(uTime * .00012 + aPhase) * .0028 + cos(orbit) * .012 * uHover) * uMotion;
  transformed.y += (cos(uTime * .0001 + aPhase * 1.37) * .0035 + sin(orbit * 1.17) * .015 * uHover) * uMotion;
  gl_Position = vec4(transformed, 1.0);
  gl_PointSize = max(0.65, aSize * uPointScale * uPixelRatio * (1.0 + transformed.z * .12));
  vBrightness = aBrightness;
}`;

const fragmentShader = `
uniform vec3 uColor;
uniform float uOpacity;
varying float vBrightness;
void main() {
  float radius = length(gl_PointCoord - vec2(.5));
  float core = 1.0 - smoothstep(.06, .31, radius);
  float halo = 1.0 - smoothstep(.16, .5, radius);
  float alpha = (core * .82 + halo * .42) * vBrightness * uOpacity;
  if (alpha < .012) discard;
  gl_FragColor = vec4(uColor * (1.12 + core * .55), alpha);
}`;

function attributes(geometry, data) {
  geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(data.sizes, 1));
  geometry.setAttribute("aBrightness", new THREE.BufferAttribute(data.brightness, 1));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(data.phases, 1));
  return geometry;
}

function material({ color, opacity, pointScale, pixelRatio, reducedMotion, hover = 0 }) {
  return new THREE.ShaderMaterial({
    vertexShader, fragmentShader, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 }, uMotion: { value: reducedMotion ? 0 : 1 },
      uPixelRatio: { value: pixelRatio }, uPointScale: { value: pointScale },
      uHover: { value: hover },
      uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity },
    },
  });
}

function combineLogos(core, masks, profile) {
  const centers = [-.82, -.38, .1, .62];
  const centerY = profile.name === "reference" ? .2 : profile.name === "tablet" ? .34 : .24;
  const widths = [.105, .105, .1, .09], heights = [.27, .27, .3, .27];
  const buffers = masks.map((mask, index) => core.sampleLogoMask(mask, profile, profile.seed + index * 997));
  const total = profile.logoCount * 4;
  const positions = new Float32Array(total * 3), sizes = new Float32Array(total);
  const brightness = new Float32Array(total), phases = new Float32Array(total);
  buffers.forEach((buffer, logo) => {
    for (let index = 0; index < profile.logoCount; index += 1) {
      const source = index * 3, target = (logo * profile.logoCount + index) * 3;
      positions[target] = centers[logo] + buffer.positions[source] * widths[logo];
      positions[target + 1] = centerY + buffer.positions[source + 1] * heights[logo];
      positions[target + 2] = .35 + buffer.positions[source + 2];
      const attribute = logo * profile.logoCount + index;
      sizes[attribute] = buffer.sizes[index] * 1.04;
      brightness[attribute] = buffer.brightness[index];
      phases[attribute] = buffer.phases[index];
    }
  });
  return { positions, sizes, brightness, phases };
}

function flowData(core, profile) {
  const flow = core.buildAtmosphere({ ...profile, atmosphereCount: profile.flowCount }, profile.seed ^ 0x91e10da5);
  const random = core.seededRandom(profile.seed ^ 0x4f1bbcdc);
  const centers = [-.82, -.38, .1, .62];
  const centerY = profile.name === "reference" ? .2 : profile.name === "tablet" ? .34 : .24;
  for (let index = 0; index < profile.flowCount; index += 1) {
    const offset = index * 3, x = flow.positions[offset];
    if (random() < .74) {
      const logo = Math.min(3, Math.floor(random() * 4));
      const radius = .035 + Math.pow(random(), 1.65) * (logo === 2 ? .29 : .255);
      const angle = random() * Math.PI * 2 + radius * 13 + logo * .48;
      flow.positions[offset] = centers[logo] + Math.cos(angle) * radius + (random() - .5) * .025;
      flow.positions[offset + 1] = centerY + Math.sin(angle) * radius * .72 + (random() - .5) * .035;
      flow.brightness[index] = Math.min(1, .28 + flow.brightness[index] * .95 + Math.max(0, .16 - radius));
      flow.sizes[index] *= .88 + random() * .55;
    } else {
      flow.positions[offset + 1] = .26 + flow.positions[offset + 1] * .86 + Math.sin(x * 7.5) * .055;
      flow.brightness[index] = Math.min(1, flow.brightness[index] * 1.25);
    }
    flow.positions[offset + 2] += .12;
  }
  return flow;
}

export function createParticleRenderer({ canvas, masks, profile, core, reducedMotion = false, onReady, onFailure }) {
  if (!canvas || !profile || !core || masks?.length !== 4) throw new TypeError("Complete particle renderer inputs are required");
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "high-performance" });
  } catch (error) {
    onFailure?.(error); throw error;
  }
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -2, 2);
  const atmosphereGeometry = new THREE.BufferGeometry();
  const flowGeometry = new THREE.BufferGeometry();
  const logoGeometry = new THREE.BufferGeometry();
  const atmosphereMaterial = material({ color: 0xd99d24, opacity: .9, pointScale: 1.22, pixelRatio: profile.pixelRatio, reducedMotion });
  const flowMaterial = material({ color: 0xf0ae2a, opacity: .9, pointScale: 1.1, pixelRatio: profile.pixelRatio, reducedMotion, hover: 1 });
  const logoGlowMaterial = material({ color: 0xf2aa2d, opacity: .28, pointScale: 2.8, pixelRatio: profile.pixelRatio, reducedMotion });
  const logoMaterial = material({ color: 0xffedaa, opacity: 1, pointScale: 1.08, pixelRatio: profile.pixelRatio, reducedMotion });
  const atmosphere = new THREE.Points(attributes(atmosphereGeometry, core.buildAtmosphere(profile, profile.seed)), atmosphereMaterial);
  const flow = new THREE.Points(attributes(flowGeometry, flowData(core, profile)), flowMaterial);
  const logos = new THREE.Points(attributes(logoGeometry, combineLogos(core, masks, profile)), logoMaterial);
  const logoGlow = new THREE.Points(logoGeometry, logoGlowMaterial);
  scene.add(atmosphere, flow, logoGlow, logos);

  let frame = 0, paused = false, disposed = false, restoreAttempted = false;
  const materials = [atmosphereMaterial, flowMaterial, logoGlowMaterial, logoMaterial];
  function resize(width = canvas.clientWidth, height = canvas.clientHeight) {
    if (!(width > 0) || !(height > 0) || disposed) return false;
    renderer.setPixelRatio(profile.pixelRatio); renderer.setSize(width, height, false);
    return true;
  }
  function render(time = 0) {
    if (disposed) return;
    materials.forEach((entry) => { entry.uniforms.uTime.value = time; });
    renderer.render(scene, camera);
  }
  function tick(time) {
    if (paused || disposed || reducedMotion) return;
    render(time); frame = requestAnimationFrame(tick);
  }
  function pause() { paused = true; cancelAnimationFrame(frame); }
  function resume() { if (!paused || disposed || reducedMotion) return; paused = false; frame = requestAnimationFrame(tick); }
  function visibilitychange() { if (document.hidden) pause(); else resume(); }
  function contextLost(event) { event.preventDefault(); pause(); onFailure?.(new Error("WebGL context lost")); }
  function contextRestored() { if (restoreAttempted || disposed) return; restoreAttempted = true; render(); resume(); }
  function dispose() {
    if (disposed) return; disposed = true; cancelAnimationFrame(frame);
    document.removeEventListener("visibilitychange", visibilitychange);
    canvas.removeEventListener("webglcontextlost", contextLost);
    canvas.removeEventListener("webglcontextrestored", contextRestored);
    [atmosphereGeometry, flowGeometry, logoGeometry].forEach((entry) => entry.dispose());
    materials.forEach((entry) => entry.dispose()); renderer.dispose();
  }
  document.addEventListener("visibilitychange", visibilitychange);
  canvas.addEventListener("webglcontextlost", contextLost);
  canvas.addEventListener("webglcontextrestored", contextRestored);
  resize(profile.width, profile.height); render(); onReady?.();
  if (!reducedMotion) frame = requestAnimationFrame(tick);
  return { render, resize, pause, resume, dispose, layers: { atmosphere, flow, logoGlow, logos } };
}
