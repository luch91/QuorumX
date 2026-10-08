# GPU Particle Hero Fidelity Design

## Status

Approved architecture. Awaiting written-spec review before implementation.

## Authority

The supplied 1467×367 reference screenshot is the visual specification. It is
not general inspiration. Existing interface structure, copy, navigation,
search, wallet behavior, labels, and verification timeline remain unchanged.
This change is limited to the particle artwork renderer.

## Objective

Replace the current Canvas 2D image-sampling animation with an immediate,
deterministic GPU composition that reproduces the reference:

- extremely dense, fine-grained golden atmospheric particles;
- four sharply defined luminous DAO logo silhouettes;
- organic horizontal flow, depth, brightness, and local density variation;
- concentrated illumination around each logo without broad blur;
- no visible assembly or convergence delay;
- no large circular particles, sparse gaps, or indistinct logo edges.

## Rendering Architecture

### Visible renderer

Three.js owns the visible canvas and WebGL lifecycle. All visible particles are
rendered as GPU point primitives using custom vertex and fragment shaders.
Canvas 2D is never used for visible compositing.

The renderer contains three draw layers:

1. `atmosphere`: fine background dust spanning the artwork region;
2. `flow`: seeded bands and eddies that create the dense organic cloud;
3. `logos`: four mask-derived point sets with edge concentration and local
   illumination.

Layer separation permits density and brightness calibration without attaching
unrelated evidence or animation behavior to the logo silhouettes.

### Offscreen masks

The four existing local WebPs are decoded into a bounded offscreen Canvas 2D
surface. Pixels become a scalar mask after source-specific luminance/alpha
normalization. Sampling produces:

- dense interior particles;
- a higher concentration near mask gradients for sharp edges;
- normalized coordinates independent of viewport size;
- deterministic points from a fixed seed.

Mask generation completes before the renderer is exposed. If decoding or a
canvas read fails, the existing deterministic procedural silhouettes remain
the fallback. A failure cannot create an empty hero.

### Shader behavior

The vertex shader applies bounded seeded displacement, viewport projection,
depth scaling, and very low-amplitude motion. The fragment shader draws small
soft-edged points with a tight luminous core and restrained falloff. Additive
blending is used with calibrated opacity; post-processing bloom is avoided
unless direct screenshot comparison proves that point-level illumination is
insufficient.

Particle motion never controls whether the composition is legible. Every
particle starts at its final composition position. Motion only adds subtle
drift and shimmer after the first complete frame.

## Determinism and Startup

- A fixed seed generates the same composition for the same layout profile.
- Logo masks and particle buffers are created once per asset/layout change.
- The first exposed WebGL frame is complete.
- Resize updates projection and bounded targets without random re-seeding.
- `prefers-reduced-motion: reduce` freezes displacement and shimmer while
  preserving the complete final frame.
- DPR is capped at the existing bound to prevent excessive GPU allocation.

## Reference Geometry

At the 1467×367 reference viewport:

- the visible artwork spans approximately the right 66% of the hero;
- the dense cloud extends across that artwork with no large empty center;
- logo centers follow the reference order: Balancer, SafeDAO, Arbitrum DAO,
  ENS DAO;
- logo illumination is locally concentrated and silhouettes remain distinct;
- labels sit directly below their matching marks;
- the verification timeline stays below the particle/logo band and remains
  unobscured.

Existing responsive profiles remain responsible for 1440, 1024, 768, 390,
and 320 CSS-pixel viewports. Mobile retains all four identities in a bounded
composition; it does not merely scale desktop coordinates.

## Performance Boundaries

- No per-frame particle-array allocation.
- One reusable `BufferGeometry` per layer.
- Particle counts are profile-specific and capped.
- The render loop pauses while the document is hidden and is disposed on
  `pagehide`.
- Reduced-motion mode renders on initialization and resize only.
- WebGL context loss shows the deterministic fallback rather than a blank
  stage.
- No remote artwork or additional network dependency is introduced.

## Failure Handling

- WebP decode failure: use the corresponding procedural mask.
- Empty or malformed mask: reject it and use the procedural mask.
- WebGL unavailable or context creation failure: use the proven Canvas 2D
  fallback as a static complete frame.
- WebGL context loss: prevent the browser default loss behavior, expose the
  static fallback, and attempt one bounded renderer restoration.
- Zero-sized initial bounds: defer GPU allocation until non-zero bounds are
  observed.

## Dependency Boundary

`three` is the only new runtime dependency. Custom shaders live locally in the
frontend source. No Three.js post-processing package or external particle
library is added unless screenshot evidence demonstrates a specific unmet
requirement and the addition receives a separate review.

## Test Design

Unit tests cover:

- deterministic seeded generation;
- mask validity and edge-weighted sampling;
- profile particle-count bounds;
- immediate final-position initialization;
- reduced-motion uniforms;
- DPR and zero-bound behavior;
- WebGL-unavailable, asset-failure, and context-loss fallbacks;
- geometry disposal and resize buffer reuse.

Browser verification covers:

- actual screenshots at 1467×367, 1440×900, 1024×900, 768×900, 390×844,
  and 320×844;
- first-frame capture before any settle interval;
- stable capture after motion begins;
- all four asset requests blocked;
- reduced motion;
- no console/WebGL errors or horizontal overflow.

The 1467×367 capture is compared directly with the supplied reference for:

- particle fineness and density;
- cloud coverage and negative space;
- logo silhouette sharpness;
- logo scale and centers;
- local brightness and glow falloff;
- label and timeline clearance.

Code-level tests cannot close the visual gate. Completion requires inspecting
the real browser screenshots.

## Compatibility

Proposal loading, search, DAO navigation, dialogs, wallet behavior, database,
API, contracts, and GenLayer code are untouched. Existing Canvas fallback
logic is preserved for unsupported or failed WebGL environments. Bradbury is
out of scope.

## Completion Criteria

The renderer is complete only when:

1. the first visible frame is fully assembled;
2. the reference-sized screenshot closely reproduces the supplied particle
   density, fine point scale, logo silhouettes, illumination, and coverage;
3. all named responsive screenshots retain four recognizable marks;
4. reduced-motion and blocked-asset cases remain complete;
5. performance, full repository verification, and browser console gates pass.
