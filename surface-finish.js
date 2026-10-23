// Restore the subtle surface variation that cannot survive a plain glTF export.
// All coordinates are metres in the model's Y-up world; no UVs are required.
const VERSION = 'architectural-surfaces-v3';
const STYLES = {
  stone: { scale: 16, depth: .0018, variation: .10 },
  wall: { scale: 14, depth: .002, variation: .11 },
  roof: { scale: 22, depth: .0024, variation: .10 },
  lead: { scale: 2.2, depth: .012, variation: 0 },
  paving: { scale: 6, depth: .012, variation: .25 },
};

function classify(material) {
  const name = material.name.toLowerCase();
  if (/(?:medieval|refined house|historic).*(terrain|lane earth|worn cobbles|paving)/.test(name)) return 'paving';
  if (/baked weathered lead/.test(name)) return 'lead';
  if (/terracotta|roofcraft|weathered colonnade tiles|(?:medieval|refined house).*roof/.test(name)) return 'roof';
  if (/coursed travertine walls|travertine wall/.test(name)) return 'wall';
  if (/travertine|colonnade limestone|pale stone ribs|dressed pale stone|stone in recess/.test(name)) return 'stone';
  if (/(?:medieval|refined house|historic).*(limewash|plaster|ochre|weathered stone|limestone|sandstone|stone coping|dressed stone)/.test(name)) return 'stone';
  return null;
}

const FRAGMENT_HELPERS = /* glsl */`
varying vec3 vArchitecturalPosition;
uniform float architecturalGrainScale;
uniform float architecturalDepth;
uniform float architecturalVariation;

float architecturalHash(vec3 p) {
  p = fract(p * .1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float architecturalNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(architecturalHash(i), architecturalHash(i + vec3(1,0,0)), f.x),
                 mix(architecturalHash(i + vec3(0,1,0)), architecturalHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(architecturalHash(i + vec3(0,0,1)), architecturalHash(i + vec3(1,0,1)), f.x),
                 mix(architecturalHash(i + vec3(0,1,1)), architecturalHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
// Screen derivatives suppress subpixel grain and joints while orbiting.
float architecturalFootprint(vec3 p) {
  return max(length(dFdx(p)), length(dFdy(p)));
}
#ifdef ARCHITECTURAL_WALL
float architecturalJoint(vec2 p) {
  float row = floor(p.y / 1.2);
  vec2 cell = vec2(p.x + mod(row, 2.0) * 1.4, p.y) / vec2(2.8, 1.2);
  vec2 edge = min(fract(cell), 1.0 - fract(cell)) * vec2(2.8, 1.2);
  vec2 aa = max(fwidth(p), vec2(.002));
  vec2 line = 1.0 - smoothstep(vec2(.006), vec2(.006) + aa, edge);
  float fade = 1.0 - smoothstep(.18, .60, max(aa.x, aa.y));
  return max(line.x, line.y) * fade;
}
#endif
// Derivative form of a height-field normal, in the same view space as Three's normal.
vec3 architecturalPerturb(vec3 position, vec3 n, float height, float facing) {
  vec3 dx = dFdx(position), dy = dFdy(position);
  vec3 r1 = cross(dy, n), r2 = cross(n, dx);
  float det = dot(dx, r1) * facing;
  vec3 gradient = sign(det) * (dFdx(height) * r1 + dFdy(height) * r2);
  return abs(det) > 1e-12 ? normalize(abs(det) * n - gradient) : n;
}
`;

const COLOR_FINISH = /* glsl */`
#include <color_fragment>
float architecturalPixel = architecturalFootprint(vArchitecturalPosition);
float architecturalGrainFade = 1.0 - smoothstep(.45, 1.7, architecturalPixel * architecturalGrainScale);
float architecturalGrain = (architecturalNoise(vArchitecturalPosition * architecturalGrainScale) - .5) * architecturalGrainFade;
float architecturalBroad = architecturalNoise(vArchitecturalPosition * .37) - .5;
float architecturalHeight = architecturalGrain * architecturalDepth;
#ifndef ARCHITECTURAL_LEAD
  // Multiplicative variation stays centred on the exported base colour.
  diffuseColor.rgb *= 1.0 + architecturalBroad * architecturalVariation + architecturalGrain * .032;
#endif
#ifdef ARCHITECTURAL_PAVING
  vec2 pavingPosition = vArchitecturalPosition.xz;
  float pavingRow = floor(pavingPosition.y / .48);
  vec2 pavingCell = vec2(pavingPosition.x + mod(pavingRow, 2.0) * .36, pavingPosition.y) / vec2(.72, .48);
  vec2 pavingEdge = min(fract(pavingCell), 1.0 - fract(pavingCell)) * vec2(.72, .48);
  float pavingJoint = 1.0 - smoothstep(.015, .015 + max(architecturalPixel, .004), min(pavingEdge.x, pavingEdge.y));
  float pavingFade = 1.0 - smoothstep(.14, .65, architecturalPixel);
  float pavingTone = architecturalHash(vec3(floor(pavingCell), 4.0)) - .5;
  diffuseColor.rgb *= 1.0 + pavingTone * .24 * pavingFade - pavingJoint * .18 * pavingFade;
  architecturalHeight -= pavingJoint * .028 * pavingFade;
#endif
#ifdef ARCHITECTURAL_WALL
  vec3 architecturalGeometricNormal = normalize(cross(dFdx(vArchitecturalPosition), dFdy(vArchitecturalPosition)));
  vec2 architecturalWallWeight = pow(abs(architecturalGeometricNormal.xz), vec2(4.0));
  float architecturalAxis = architecturalWallWeight.x / max(architecturalWallWeight.x + architecturalWallWeight.y, .0001);
  float architecturalMortar = mix(architecturalJoint(vArchitecturalPosition.xy), architecturalJoint(vArchitecturalPosition.zy), architecturalAxis);
  architecturalMortar *= pow(1.0 - abs(architecturalGeometricNormal.y), 2.0);
  diffuseColor.rgb *= 1.0 - architecturalMortar * .06;
  architecturalHeight -= architecturalMortar * .008;
#endif
`;

/** Apply once per shared material. Preserves textures, vertex colours and PBR lighting. */
export function restoreArchitecturalSurfaces(THREE, root) {
  if (!THREE.ShaderChunk.normal_fragment_maps || !root?.traverse) return { materials: 0, categories: {} };
  const report = { materials: 0, categories: {} };
  root.traverse(object => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material?.isMeshStandardMaterial || material.userData.architecturalSurfaceFinish) continue;
      const category = classify(material);
      if (!category) continue;
      const style = STYLES[category];
      const previousCompile = material.onBeforeCompile;
      // Capture the existing key before installing our own compile callback.
      const previousKey = material.customProgramCacheKey();
      material.onBeforeCompile = function (shader, renderer) {
        previousCompile.call(this, shader, renderer);
        shader.uniforms.architecturalGrainScale = { value: style.scale };
        shader.uniforms.architecturalDepth = { value: style.depth };
        shader.uniforms.architecturalVariation = { value: style.variation };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vArchitecturalPosition;')
          .replace('#include <worldpos_vertex>', /* glsl */`
            #include <worldpos_vertex>
            vec4 architecturalWorld = vec4(transformed, 1.0);
            #ifdef USE_BATCHING
              architecturalWorld = batchingMatrix * architecturalWorld;
            #endif
            #ifdef USE_INSTANCING
              architecturalWorld = instanceMatrix * architecturalWorld;
            #endif
            vArchitecturalPosition = (modelMatrix * architecturalWorld).xyz;
          `);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\n#define ARCHITECTURAL_${category.toUpperCase()}\n${FRAGMENT_HELPERS}`)
          .replace('#include <color_fragment>', COLOR_FINISH)
          .replace('#include <normal_fragment_maps>', /* glsl */`
            #include <normal_fragment_maps>
            normal = architecturalPerturb(-vViewPosition, normal, architecturalHeight, faceDirection);
          `);
      };
      material.customProgramCacheKey = () => `${previousKey}|${VERSION}|${category}`;
      material.userData.architecturalSurfaceFinish = { version: VERSION, category };
      material.needsUpdate = true;
      report.materials += 1;
      report.categories[category] = (report.categories[category] || 0) + 1;
    }
  });
  return report;
}
