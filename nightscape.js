// Blue-hour lighting: six local lights, warm architectural washes and candlelight.
// Material changes use one shared uniform, so a switch does not reload any asset.
// applyBlend(t) drives every setting continuously, so dusk and dawn can animate.
const VERSION = 'nightscape-v1';

export function createNightscape({ THREE, scene, renderer, daylight, requestRender }) {
  const NIGHT = {
    sky: { zenith: new THREE.Color('#101c42'), horizon: new THREE.Color('#435373'), lower: new THREE.Color('#172436') },
    fog: new THREE.Color('#435373'), fogNear: 900, fogFar: 3300,
    sun: new THREE.Color('#a3c1ff'), sunIntensity: .38,
    fill: new THREE.Color('#829fdb'), ground: new THREE.Color('#243448'), fillIntensity: .85,
    exposure: 1.12, environmentIntensity: .24,
  };
  const amount = { value: 0 };
  const materials = new Set(), roots = new Set();
  const stats = { materials: 0, warmWindowMaterials: 0, candleWindowMaterials: 0, darkWindowMaterials: 0, lanternMaterials: 0, lanternGlows: 0 };
  const uniforms = daylight.sky.material.uniforms;
  const original = {
    fog: scene.fog, environment: scene.environment, environmentIntensity: scene.environmentIntensity,
    exposure: renderer.toneMappingExposure, sun: daylight.sun.color.clone(), sunIntensity: daylight.sun.intensity,
    sky: Object.fromEntries(['zenith','horizon','lower'].map(key => [key, uniforms[key].value.clone()])),
    fill: daylight.fill.color.clone(), ground: daylight.fill.groundColor.clone(), fillIntensity: daylight.fill.intensity,
  };
  // scene.fog is mutated in place while blending, so keep its daytime numbers aside.
  const originalFog = { color: scene.fog.color.clone(), near: scene.fog.near, far: scene.fog.far };
  let enabled = false, blend = 0, nightEnvironment = null;
  const lights = new THREE.Group();
  lights.name = 'Night architectural light'; lights.visible = false;
  scene.add(lights);
  function spot(name, position, target, color, intensity, distance, angle, penumbra = .65) {
    const light = new THREE.SpotLight(color, intensity, distance, angle, penumbra, 2);
    light.name = name; light.position.set(...position); light.target.position.set(...target);
    light.castShadow = false;
    light.userData.baseIntensity = intensity;
    lights.add(light, light.target);
  }
  spot('Warm facade west', [-38,8,221], [-25,26,159], 0xffbd6f, 31000, 190, .64);
  spot('Warm facade east', [38,8,221], [25,26,159], 0xffc788, 31000, 190, .64);
  spot('Dome lantern and drum west', [-83,55,102], [0,93,24], 0xffd395, 22000, 220, .47);
  spot('Dome lantern and drum east', [76,62,-38], [0,95,24], 0xc5d9ff, 19000, 220, .49);
  spot('Piazza west arcade', [-125,15,355], [-95,8,330], 0xffdfb7, 850, 90, .95);
  spot('Piazza east arcade', [125,15,355], [95,8,330], 0xffdfb7, 850, 90, .95);

  const fragmentHelpers = /* glsl */`
    varying vec3 vNightWorld;
    uniform float nightAmount;
    float nightHash(vec3 p) {
      p = fract(p * .1031); p += dot(p, p.yzx + 33.33);
      return fract((p.x + p.y) * p.z);
    }
    float nightPool(vec2 p, vec2 center, float radius) {
      vec2 d = (p-center)/radius;
      return exp(-dot(d,d)*2.7);
    }
  `;
  function finishMaterial(material, surroundings) {
    if (!material?.isMeshStandardMaterial || materials.has(material)) return;
    materials.add(material);
    const name = material.name;
    let kind = 'surface';
    if (/House window\s*\|\s*amber/i.test(name)) { kind = 'amber'; stats.warmWindowMaterials++; }
    else if (/House window\s*\|\s*candle/i.test(name)) { kind = 'candle'; stats.candleWindowMaterials++; }
    else if (/House window\s*\|\s*dark/i.test(name)) { kind = 'dark'; stats.darkWindowMaterials++; }
    else if (/House lantern\s*\|\s*glass/i.test(name)) { kind = 'lantern'; stats.lanternMaterials++; }
    else if (/Medieval town.*window dark/i.test(name)) kind = 'legacy-window';
    const previousCompile = material.onBeforeCompile, previousKey = material.customProgramCacheKey();
    material.onBeforeCompile = function(shader, renderer) {
      previousCompile.call(this, shader, renderer);
      shader.uniforms.nightAmount = amount;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vNightWorld;')
        .replace('#include <worldpos_vertex>', /* glsl */`
          #include <worldpos_vertex>
          vec4 nightWorld = vec4(transformed,1.0);
          #ifdef USE_BATCHING
            nightWorld = batchingMatrix * nightWorld;
          #endif
          #ifdef USE_INSTANCING
            nightWorld = instanceMatrix * nightWorld;
          #endif
          vNightWorld = (modelMatrix * nightWorld).xyz;
        `);
      let emission = '';
      if (kind === 'amber') emission = 'vec3(1.0,.37,.075) * 2.8 * (.72 + .35 * nightHash(floor(vNightWorld / 3.0)))';
      if (kind === 'candle') emission = 'vec3(1.0,.57,.19) * 1.25 * (.75 + .3 * nightHash(floor(vNightWorld / 3.0)))';
      if (kind === 'lantern') emission = 'vec3(1.0,.28,.045) * 4.5';
      // Old context has a single shared window material. Keep most windows dark.
      if (kind === 'legacy-window') emission = 'vec3(1.0,.40,.10) * 1.75 * step(.79, nightHash(floor(vNightWorld / vec3(3.1,3.7,3.1))))';
      let wash = '';
      if (!surroundings) wash = /* glsl */`
        float facadeWash = nightPool(vNightWorld.xz,vec2(0.0,159.0),70.0)
          * smoothstep(0.0,7.0,vNightWorld.y) * (1.0-smoothstep(40.0,57.0,vNightWorld.y));
        float drumWash = nightPool(vNightWorld.xz,vec2(0.0,24.0),40.0)
          * smoothstep(57.0,69.0,vNightWorld.y) * (1.0-smoothstep(83.0,96.0,vNightWorld.y));
        float lanternWash = nightPool(vNightWorld.xz,vec2(0.0,24.0),12.0)
          * smoothstep(112.0,121.0,vNightWorld.y);
        float arcadeRing = abs(length(vec2(vNightWorld.x/98.0,(vNightWorld.z-330.0)/75.0))-1.0);
        float arcadeWash = (1.0-smoothstep(.07,.19,arcadeRing))
          * smoothstep(.3,2.0,vNightWorld.y) * (1.0-smoothstep(15.0,20.0,vNightWorld.y));
        float obeliskWash = nightPool(vNightWorld.xz,vec2(0.0,330.0),10.0)
          * smoothstep(.6,3.0,vNightWorld.y) * (1.0-smoothstep(27.0,39.0,vNightWorld.y));
        float fountainWash = (nightPool(vNightWorld.xz,vec2(-55.0,330.0),10.0)
          + nightPool(vNightWorld.xz,vec2(55.0,330.0),10.0))
          * smoothstep(.4,1.4,vNightWorld.y) * (1.0-smoothstep(9.0,12.0,vNightWorld.y));
        totalEmissiveRadiance += nightAmount * diffuseColor.rgb * vec3(1.0,.46,.16)
          * (facadeWash*.34 + drumWash*.23 + lanternWash*.8);
        totalEmissiveRadiance += nightAmount * diffuseColor.rgb * vec3(1.0,.77,.51)
          * (arcadeWash*.30 + obeliskWash*.60 + fountainWash*.45);
      `;
      if (kind === 'surface') wash += /* glsl */`
        float plazaFloor = 1.0-smoothstep(.8,5.0,vNightWorld.y);
        float pool = nightPool(vNightWorld.xz,vec2(-55.0,330.0),15.0)
          + nightPool(vNightWorld.xz,vec2(55.0,330.0),15.0)
          + nightPool(vNightWorld.xz,vec2(0.0,330.0),20.0)
          + nightPool(vNightWorld.xz,vec2(-58.0,184.0),24.0)
          + nightPool(vNightWorld.xz,vec2(58.0,184.0),24.0)
          + nightPool(vNightWorld.xz,vec2(-270.0,520.0),22.0)
          + nightPool(vNightWorld.xz,vec2(255.0,350.0),22.0);
        totalEmissiveRadiance += nightAmount * diffuseColor.rgb * vec3(1.0,.39,.09) * pool * plazaFloor * .36;
      `;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${fragmentHelpers}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${emission ? `totalEmissiveRadiance += nightAmount * (${emission});` : ''}\n${wash}`);
    };
    material.customProgramCacheKey = () => `${previousKey}|${VERSION}|${kind}|${surroundings}`;
    material.needsUpdate = true;
    stats.materials++;
  }

  function addLanternGlows(root) {
    const cells = new Map();
    const p = new THREE.Vector3();
    root.updateWorldMatrix(true,true);
    root.traverse(object => {
      if (!object.isMesh) return;
      const mats = Array.isArray(object.material) ? object.material : [object.material];
      if (!mats.some(mat => /House lantern\s*\|\s*glass/i.test(mat.name))) return;
      const geometry = object.geometry, position = geometry.attributes.position, index = geometry.index;
      const groups = geometry.groups.length ? geometry.groups : [{start:0,count:index?.count ?? position.count,materialIndex:0}];
      for (const group of groups) {
        if (!/House lantern\s*\|\s*glass/i.test(mats[group.materialIndex]?.name ?? '')) continue;
        for (let i=group.start; i<group.start+group.count; i+=3) {
          p.fromBufferAttribute(position,index ? index.getX(i) : i).applyMatrix4(object.matrixWorld);
          const key = [Math.round(p.x/2),Math.round(p.y/2),Math.round(p.z/2)].join(',');
          if (!cells.has(key)) cells.set(key,p.clone());
        }
      }
    });
    if (!cells.size) return;
    const points = [...cells.values()].sort((a,b) => a.lengthSq()-b.lengthSq()).slice(0,220);
    const geo = new THREE.BufferGeometry().setFromPoints(points.map(p => root.worldToLocal(p)));
    const mat = new THREE.ShaderMaterial({
      transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
      uniforms:{nightAmount:amount},
      vertexShader:`void main(){vec4 p=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*p;gl_PointSize=clamp(2500.0/max(10.0,-p.z),2.0,30.0);}`,
      fragmentShader:`uniform float nightAmount;void main(){float r=length(gl_PointCoord-.5)*2.0;float glow=exp(-r*r*5.5)*(1.0-smoothstep(.65,1.0,r));gl_FragColor=vec4(1.0,.34,.06,glow*.27*nightAmount);}`,
    });
    const glow = new THREE.Points(geo,mat); glow.name='Warm lantern halos'; glow.frustumCulled=false;
    root.add(glow); stats.lanternGlows += points.length;
  }
  function registerModel(root, surroundings=false) {
    if (roots.has(root)) return;
    roots.add(root);
    root.traverse(object => {
      if (object.isMesh) (Array.isArray(object.material) ? object.material : [object.material]).forEach(mat => finishMaterial(mat,surroundings));
    });
    if (surroundings) addLanternGlows(root);
    requestRender();
  }
  function applyBlend(value) {
    blend = THREE.MathUtils.clamp(value, 0, 1);
    enabled = blend >= .5;
    amount.value = blend;
    lights.visible = blend > .0005;
    for (const child of lights.children) if (child.isLight) child.intensity = child.userData.baseIntensity * blend;
    for (const key of ['zenith','horizon','lower']) uniforms[key].value.copy(original.sky[key]).lerp(NIGHT.sky[key], blend);
    uniforms.sunStrength.value = 1 - blend;
    if (blend > 0 && !nightEnvironment) {
      const skyScene = new THREE.Scene(); skyScene.add(daylight.sky.clone());
      const pmrem = new THREE.PMREMGenerator(renderer);
      nightEnvironment = pmrem.fromScene(skyScene, .04, .1, 13000); pmrem.dispose();
    }
    // The two environments cannot crossfade; swap at the midpoint of the blend.
    scene.environment = blend >= .5 && nightEnvironment ? nightEnvironment.texture : original.environment;
    scene.environmentIntensity = THREE.MathUtils.lerp(original.environmentIntensity, NIGHT.environmentIntensity, blend);
    scene.fog.color.copy(originalFog.color).lerp(NIGHT.fog, blend);
    scene.fog.near = THREE.MathUtils.lerp(originalFog.near, NIGHT.fogNear, blend);
    scene.fog.far = THREE.MathUtils.lerp(originalFog.far, NIGHT.fogFar, blend);
    daylight.sun.color.copy(original.sun).lerp(NIGHT.sun, blend);
    daylight.sun.intensity = THREE.MathUtils.lerp(original.sunIntensity, NIGHT.sunIntensity, blend);
    daylight.fill.color.copy(original.fill).lerp(NIGHT.fill, blend);
    daylight.fill.groundColor.copy(original.ground).lerp(NIGHT.ground, blend);
    daylight.fill.intensity = THREE.MathUtils.lerp(original.fillIntensity, NIGHT.fillIntensity, blend);
    renderer.toneMappingExposure = THREE.MathUtils.lerp(original.exposure, NIGHT.exposure, blend);
    requestRender();
  }
  function setEnabled(next) {
    enabled = Boolean(next);
    applyBlend(enabled ? 1 : 0);
    renderer.shadowMap.needsUpdate = true;
  }
  return { registerModel, setEnabled, applyBlend, get enabled(){return enabled;}, get blend(){return blend;},
    report:() => ({...stats,enabled,blend,localLights:6,shadowCastingLocalLights:0}),
    dispose(){nightEnvironment?.dispose();lights.removeFromParent();},
  };
}
