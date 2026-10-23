// An outdoor sky with a directional key light; no indoor softbox environment.
export function createDaylight(THREE, scene, renderer) {
  const sunDirection = new THREE.Vector3(-550, 555, 645).normalize();
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: new THREE.Color('#527ca4') },
      horizon: { value: new THREE.Color('#c4d1d6') },
      lower: { value: new THREE.Color('#877a64') },
      sunDirection: { value: sunDirection },
      sunStrength: { value: 1 },
    },
    vertexShader: `varying vec3 vSkyDirection;
      void main() {
        vSkyDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `varying vec3 vSkyDirection;
      uniform vec3 zenith, horizon, lower, sunDirection;
      uniform float sunStrength;
      void main() {
        vec3 direction = normalize(vSkyDirection);
        float elevation = direction.y;
        vec3 sky = mix(horizon, zenith, pow(max(elevation, 0.0), .48));
        if (elevation < 0.0) sky = mix(horizon, lower, min(-elevation * 3.0, 1.0));
        float sunAngle = max(dot(direction, sunDirection), 0.0);
        sky += vec3(1.0, .76, .44) * (pow(sunAngle, 22.0)*.1 + pow(sunAngle, 700.0)*2.0) * sunStrength;
        gl_FragColor = vec4(sky, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(6000, 32, 16), skyMaterial);
  sky.name = 'Outdoor sky';
  sky.renderOrder = -100;
  scene.background = null;
  scene.add(sky);
  scene.fog = new THREE.Fog('#c4d1d6', 1050, 3400);
  const environmentScene = new THREE.Scene();
  environmentScene.add(sky.clone());
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(environmentScene, .04, .1, 13000).texture;
  // r180 uses Scene.environmentIntensity for materials inheriting Scene.environment.
  scene.environmentIntensity = .45;
  pmrem.dispose();
  const fill = new THREE.HemisphereLight(0xbbd3ec, 0x756650, 1.3);
  fill.name = 'Blue sky and warm ground fill';
  scene.add(fill);
  const sun = new THREE.DirectionalLight(0xffe0b5, 3.4);
  sun.name = 'Afternoon sun';
  sun.position.set(-550,580,820);
  sun.target.position.set(0,25,175);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096,4096);
  Object.assign(sun.shadow.camera, {left:-285,right:285,top:285,bottom:-285,near:250,far:1900});
  sun.shadow.normalBias = .1;
  sun.shadow.bias = -.000035;
  sun.shadow.radius = 1.5;
  scene.add(sun, sun.target);
  renderer.toneMappingExposure = 1.03;
  function setShadowExtent(extent) {
    Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent });
    sun.shadow.camera.updateProjectionMatrix();
  }
  return { sky, sun, fill, setShadowExtent };
}
