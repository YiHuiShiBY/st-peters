import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { createDaylight } from './daylight.js';
import { createNightscape } from './nightscape.js';
import { restoreArchitecturalSurfaces } from './surface-finish.js';

const $ = (selector) => document.querySelector(selector);
const loading = $('#loading');
const status = $('#status');
const requiresModel = [...document.querySelectorAll('[data-requires-model]')];
requiresModel.forEach(button => button.disabled = true);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const VIEWS = {
  overview: { position: [340,250,600], target: [0,40,185], fov: 35, shadowExtent: 700, title: '教堂与圣彼得广场', description: '从穹顶到柱廊，沿中轴线展开的建筑全景。' },
  facade: { position: [0,18,425], target: [0,62,115], fov: 41, shadowExtent: 285, title: '正面立面', description: '巨柱、山花与屋顶雕像，共同构成立面的层次。' },
  dome: { position: [90,139,168], target: [0,96,24], fov: 40, shadowExtent: 240, title: '主穹顶与鼓座', description: '细看铅皮屋面、凸肋、窗楣与花环饰带。' },
  plan: { position: [0,900,170.1], target: [0,0,170], fov: 45, shadowExtent: 700, title: '教堂、院落与历史街区', description: '北侧宫殿、南侧宗教院落、入口街巷与后方围墙花园。' },
  reverse: { position: [75,183,-143], target: [0,30,285], fov: 51, shadowExtent: 420, title: '从后殿望向广场', description: '绕到建筑后方，查看后殿曲线与大小穹顶。' },
  town: { position: [365,47,430], target: [267,10,350], fov: 45, shadowExtent: 260, title: '红瓦街巷与布棚集市', description: '走近弧形红瓦、木百叶、小阳台与挂着灯笼的店铺。' },
  garden: { position: [165,65,-20], target: [5,12,-242], fov: 49, shadowExtent: 340, title: '花园与树冠层次', description: '穿过伞松、橡树和柏树，细看分叉枝干与疏密相间的树冠。' },
};
let renderer, scene, camera, controls, contextModel, basilicaModel, daylight, nightscape;
let lighting = 'day', modelLoads = 0, uiHidden = false, lightingTween = null, lightingReady = false;
try { lighting = localStorage.getItem('st-peters-lighting') === 'night' ? 'night' : 'day'; } catch {}
let modelReady = false, contextReady = false, contextVisible = true;
let viewKey = 'overview', tween = null, scheduled = false, previousTime = 0;
let pulseTimer;
// 自由飞相机状态必须放模块层：render() 每帧引用它，若声明在 start() 里
// 会每帧 ReferenceError，渲染在画布输出前就中断（10-17 套件重构踩过）
let fly = null;
// 个别环境（后台标签、未布局的 webview）启动时 innerWidth 为 0：
// 先按桌面口径兜底，等 refreshViewport 拿到真实尺寸再校正
let narrowViewport = (innerWidth || 1280) < 650;
const draco = new DRACOLoader().setDecoderPath('./vendor/draco/').setWorkerLimit(4);
const modelLoader = new GLTFLoader().setDRACOLoader(draco);

function setStatus(message, temporary = false) {
  clearTimeout(pulseTimer);
  status.textContent = message;
  if (temporary) pulseTimer = setTimeout(() => status.textContent = contextReady ? '自由旋转 · 探索每一面' : '周边环境正在载入…', 2800);
}
function requestRender() {
  if (!scheduled && !document.hidden) {
    scheduled = true;
    requestAnimationFrame(render);
  }
}
function render(time) {
  scheduled = false;
  const delta = Math.min((time - previousTime) / 1000 || 1 / 60, .05);
  previousTime = time;
  if (tween) {
    const progress = Math.min((time - tween.start) / tween.duration, 1);
    const eased = tween.cinematic
      ? progress * progress * progress * (progress * (progress * 6 - 15) + 10)
      : 1 - Math.pow(1 - progress, 3);
    if (tween.controlPosition) {
      const inverse = 1 - eased;
      camera.position.copy(tween.fromPosition).multiplyScalar(inverse * inverse)
        .addScaledVector(tween.controlPosition, 2 * inverse * eased)
        .addScaledVector(tween.toPosition, eased * eased);
    } else camera.position.lerpVectors(tween.fromPosition, tween.toPosition, eased);
    controls.target.lerpVectors(tween.fromTarget, tween.toTarget, eased);
    camera.fov = THREE.MathUtils.lerp(tween.fromFov, tween.toFov, eased);
    camera.updateProjectionMatrix();
    if (progress === 1) tween = null;
  }
  if (lightingTween) {
    const progress = Math.min((time - lightingTween.start) / lightingTween.duration, 1);
    const eased = progress * progress * (3 - 2 * progress);
    nightscape.applyBlend(THREE.MathUtils.lerp(lightingTween.from, lightingTween.to, eased));
    if (progress === 1) lightingTween = null;
  }
  const changed = fly && fly.mode === 'orbit' ? controls.update(delta) : false;
  if (camera.position.y < .8) {
    camera.position.y = .8;
    camera.lookAt(controls.target);
  }
  renderer.render(scene, camera);
  if (tween || lightingTween || (fly && fly.mode === 'orbit' && (controls.autoRotate || changed))) requestRender();
}
function fittedFov(fov) {
  // 读 narrowViewport 变量而非裸 innerWidth：0 尺寸启动时不误判窄屏（真值由 refreshViewport 维护）
  return narrowViewport ? Math.min(fov + 22, 78) : fov
}
function mobileDistanceScale(key) {
  return key === 'overview' ? 1.6 : key === 'plan' ? 1.4 : 1.15;
}
function stopRotation() {
  controls.autoRotate = false;
  $('#auto-rotate').setAttribute('aria-pressed', 'false');
}
function setLighting(next, announce = true) {
  const previous = lighting;
  lighting = next === 'night' ? 'night' : 'day';
  document.documentElement.dataset.lighting = lighting;
  document.querySelectorAll('[data-lighting-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.lightingChoice === lighting)));
  document.querySelector('meta[name="theme-color"]').content = lighting === 'night' ? '#142039' : '#e8e8df';
  try { localStorage.setItem('st-peters-lighting', lighting); } catch {}
  const to = lighting === 'night' ? 1 : 0;
  // First call applies the stored preference instantly; later ones glide through dusk.
  if (lighting !== previous && lightingReady && !reducedMotion) {
    lightingTween = { start: performance.now(), duration: 1800, from: nightscape.blend, to };
    renderer.shadowMap.needsUpdate = true;
    requestRender();
  } else {
    lightingTween = null;
    nightscape.applyBlend(to);
  }
  lightingReady = true;
  if (announce) setStatus(lighting === 'night' ? '入夜 · 金色穹顶与街巷烛光渐次亮起' : '破晓 · 天色渐亮回到午后阳光', true);
}
function setUIHidden(hidden) {
  uiHidden = Boolean(hidden);
  document.body.classList.toggle('ui-hidden', uiHidden);
  $('#show-ui').hidden = !uiHidden;
  $('#hide-ui').setAttribute('aria-pressed', String(uiHidden));
  if (!uiHidden) $('#hide-ui').focus({ preventScroll: true });
}
function selectView(key, animate = true) {
  const view = VIEWS[key];
  if (!view) return;
  const previousView = viewKey;
  stopRotation();
  viewKey = key;
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === key)));
  $('#view-name').textContent = view.title;
  $('#view-description').textContent = view.description;
  const target = new THREE.Vector3(...view.target);
  // Keep fine branch shadows around the selected subject, including the garden
  // behind the basilica. Sun direction remains identical across every preset.
  if (daylight) {
    daylight.setShadowExtent(view.shadowExtent);
    daylight.sun.target.position.set(target.x, 25, target.z);
    daylight.sun.position.copy(daylight.sun.target.position).add(new THREE.Vector3(-550,555,645));
    renderer.shadowMap.needsUpdate = true;
  }
  const position = new THREE.Vector3(...view.position);
  if (narrowViewport) position.sub(target).multiplyScalar(mobileDistanceScale(key)).add(target);
  const fov = fittedFov(view.fov);
  // Clear remaining damping velocity before starting a preset transition.
  const wasDamping = controls.enableDamping;
  controls.enableDamping = false;
  controls.update();
  controls.enableDamping = wasDamping;
  if (animate && !reducedMotion) {
    const cinematic = (previousView === 'plan' && key === 'reverse') || (previousView === 'reverse' && key === 'plan');
    const controlPosition = cinematic
      ? new THREE.Vector3(185, Math.max(camera.position.y, position.y) * .57, -80)
      : null;
    tween = { start: performance.now(), duration: cinematic ? 3000 : 1050, cinematic, controlPosition, fromPosition: camera.position.clone(), toPosition: position, fromTarget: controls.target.clone(), toTarget: target, fromFov: camera.fov, toFov: fov };
  } else {
    tween = null;
    camera.position.copy(position);
    controls.target.copy(target);
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  requestRender();
}
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
let lastFlyAt = 0;
function flyTo(point) {
  stopRotation();
  const offset = camera.position.clone().sub(point);
  const distance = THREE.MathUtils.clamp(offset.length() * .42, 26, 900);
  const position = point.clone().addScaledVector(offset.normalize(), distance);
  if (position.y < 2) position.y = 2;
  tween = { start: performance.now(), duration: 950, cinematic: false, controlPosition: null,
    fromPosition: camera.position.clone(), toPosition: position,
    fromTarget: controls.target.clone(), toTarget: point,
    fromFov: camera.fov, toFov: camera.fov };
  requestRender();
}
function focusPoint(clientX, clientY) {
  if (!modelReady || performance.now() - lastFlyAt < 400) return;
  pointerNdc.set(clientX / innerWidth * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointerNdc, camera);
  const targets = basilicaModel ? [basilicaModel] : [];
  if (contextModel?.visible) targets.push(contextModel);
  // Skip the additive lantern-glow points; only solid architecture counts.
  const hit = raycaster.intersectObjects(targets, true).find(item => item.object.isMesh && item.object.visible);
  if (!hit) { setStatus('双击建筑表面可飞近细看', true); return; }
  lastFlyAt = performance.now();
  flyTo(hit.point);
  setStatus('已飞近 · 拖动细看，复位/H 回到全景', true);
}
function prepareModel(root, surroundings = false) {
  restoreArchitecturalSurfaces(THREE, root);
  root.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = !/terrain|water|pavement|lawns|parterres|gravel.paths|canopy.*shadow|lane.earth|cobble.approach|borgo.historic.lanes.*(weathered.dark.stone|turf)/i.test(object.name);
    object.receiveShadow = true;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach(material => {
      if (material.map) material.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    });
  });
  scene.add(root);
  nightscape.registerModel(root, surroundings);
  renderer.shadowMap.needsUpdate = true;
  requestRender();
}
function loadAsset(url, onProgress) {
  modelLoads++;
  return new Promise((resolve, reject) => modelLoader.load(url, resolve, onProgress, reject));
}
async function loadModels() {
  const core = await loadAsset('./assets/basilica-medieval.glb', event => {
    if (event.total) {
      const percent = Math.min(Math.round(event.loaded / event.total * 100), 99);
      $('#progress-bar').style.width = `${percent}%`;
      $('#loading-label').textContent = percent === 99 ? '正在准备三维场景…' : `载入建筑细节 · ${percent}%`;
    }
  });
  core.scene.name = 'Photo-refined basilica';
  basilicaModel = core.scene;
  prepareModel(core.scene);
  modelReady = true;
  requiresModel.forEach(button => button.disabled = false);
  $('#progress-bar').style.width = '100%';
  loading.classList.add('finished');
  setStatus('周边环境正在载入…');
  requestRender();
  try {
    const context = await loadAsset('./assets/context-historic.glb');
    contextModel = context.scene;
    contextModel.name = 'Historic precinct inspired by circa 1748 Rome';
    contextModel.visible = contextVisible;
    prepareModel(contextModel, true);
    contextReady = true;
    setStatus('自由旋转 · 探索每一面');
  } catch (error) {
    console.warn('Optional context could not be loaded.', error);
    setStatus('主体已就绪，刷新可重试周边环境');
    $('#context-toggle').disabled = true;
  }
}
function start() {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  // 启动瞬间可能是 0 尺寸（后台标签/webview 未布局）：兜底到文档流或桌面口径，
  // 投影矩阵绝不能吃到 0/0 = NaN——那会让视锥裁掉整座建筑只剩天空
  const initialWidth = innerWidth || document.documentElement.clientWidth || 1280;
  const initialHeight = innerHeight || document.documentElement.clientHeight || 720;
  renderer.setPixelRatio(Math.min(devicePixelRatio, initialWidth < 650 ? 1.5 : 1.75));
  renderer.setSize(initialWidth, initialHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .78;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-label', '三维模型，拖动旋转，滚轮缩放，双击飞近；也可用方向键旋转，加减键缩放');
  canvas.tabIndex = 0;
  $('#viewport').appendChild(canvas);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(44, initialWidth / initialHeight, 2, 7000);
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = .075;
  controls.minDistance = 8;
  controls.maxDistance = 1850;
  controls.maxPolarAngle = Math.PI * .58;
  controls.minPolarAngle = .002;
  controls.autoRotateSpeed = .55;
  controls.zoomSpeed = .85;
  controls.panSpeed = .8;
  controls.zoomToCursor = true;
  controls.addEventListener('change', requestRender);

  /* 操作模式套件：环绕（原生 OrbitControls）/ 键鼠第一人称（Pointer Lock 自由飞）/ 轮盘（摇杆自由飞）。
     自由飞：yaw/pitch 欧拉视角 + WASD/QE·摇杆位移，方向跟随视线；移动期间持续请求渲染帧。 */
  fly = { yaw: null, pitch: null, move: { x: 0, y: 0, z: 0 }, raf: 0, mode: 'orbit' };
  function flyAngles() {
    if (fly.yaw === null) {
      const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
      fly.yaw = Math.atan2(-dir.x, -dir.z);
      fly.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
    }
    return fly;
  }
  function flyLook(dyaw, dpitch) {
    const a = flyAngles();
    a.yaw += dyaw; a.pitch = THREE.MathUtils.clamp(a.pitch + dpitch, -1.45, 1.45);
    const cp = Math.cos(a.pitch);
    camera.lookAt(camera.position.x - Math.sin(a.yaw) * cp, camera.position.y + Math.sin(a.pitch), camera.position.z - Math.cos(a.yaw) * cp);
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    controls.target.copy(camera.position).addScaledVector(dir, 10);
    requestRender();
  }
  function flySetMove(v) {
    fly.move = v;
    if ((v.x || v.y || v.z) && !fly.raf) fly.raf = requestAnimationFrame(flyStep);
  }
  function flyStep() {
    const m = fly.move;
    if (!m.x && !m.y && !m.z) { fly.raf = 0; return; }
      const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
      const ground = Math.hypot(dir.x, dir.z) || 1;
      const hx = dir.x / ground, hz = dir.z / ground;
      const speed = 240;
      camera.position.x += (hx * m.y - hz * m.x) * speed / 60;
      camera.position.y += m.z * speed / 60;
      camera.position.z += (hz * m.y + hx * m.x) * speed / 60;
      camera.position.y = Math.max(1.5, camera.position.y);
      controls.target.copy(camera.position).addScaledVector(dir, 10);
      requestRender();
      fly.raf = requestAnimationFrame(flyStep);
  }
  const mountHost = document.createElement('div');
  mountHost.className = 'tcs-mount';
  mountHost.style.cssText = 'position:fixed;inset:0;z-index:5';
  document.body.appendChild(mountHost);
  TownControlsSuite.mount({
    mount: mountHost,
    storageKey: 'st-peters-controls',
    modes: ['orbit', 'fps', 'moba'],
    hints: {
      orbit: [['1 - 7', '七个机位'], ['B / N', '白昼 · 夜景'], ['Tab', '隐藏界面'], ['拖动旋转', '环绕视角'], ['滚轮', '缩放'], ['双指捏合', '缩放']],
      fps: [['点击画面', '锁定鼠标'], ['鼠标移动', '转视角'], ['W A S D', '平移漫游'], ['Q / E', '下降 · 上升'], ['Esc', '释放鼠标']],
      moba: [['左下摇杆', '平移漫游'], ['滑动画布', '旋转视角'], ['双指捏合', '缩放'], ['1 - 7', '切换机位']]
    },
    onModeChange(m) {
      fly.mode = m; fly.yaw = null; fly.move = { x: 0, y: 0, z: 0 }; cancelAnimationFrame(fly.raf); fly.raf = 0;
      controls.enabled = m === 'orbit';
      requestRender();
    },
    fps: { target: canvas, onLook: flyLook, onMove: flySetMove },
    moba: { onMove(v) { flySetMove({ x: v.x, y: v.y, z: 0 }); } }
  });
  controls.addEventListener('start', () => { tween = null; stopRotation(); requestRender(); });
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); setStatus('图形显示已暂停，请刷新页面恢复'); });
  // Double-click (and double-tap) glide toward the picked point on the architecture.
  canvas.addEventListener('dblclick', event => focusPoint(event.clientX, event.clientY));
  const activePointers = new Set(), touchStarts = new Map();
  let lastTap = { time: 0, x: 0, y: 0 };
  canvas.addEventListener('pointerdown', event => {
    activePointers.add(event.pointerId);
    canvas.classList.add('dragging');
    if (event.pointerType === 'touch') touchStarts.set(event.pointerId, { x: event.clientX, y: event.clientY, t: performance.now() });
  });
  function endPointer(event, cancelled) {
    activePointers.delete(event.pointerId);
    if (!activePointers.size) canvas.classList.remove('dragging');
    if (event.pointerType !== 'touch' || cancelled) return;
    const start = touchStarts.get(event.pointerId);
    touchStarts.delete(event.pointerId);
    if (!start || activePointers.size) return;
    // A quick, barely-moved single-finger lift counts as a tap; two in a row focus.
    if (performance.now() - start.t > 260 || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 9) return;
    const now = performance.now();
    if (now - lastTap.time < 340 && Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 32) {
      lastTap.time = 0;
      focusPoint(event.clientX, event.clientY);
    } else lastTap = { time: now, x: event.clientX, y: event.clientY };
  }
  canvas.addEventListener('pointerup', event => endPointer(event, false));
  canvas.addEventListener('pointercancel', event => endPointer(event, true));
  daylight = createDaylight(THREE, scene, renderer);
  nightscape = createNightscape({ THREE, scene, renderer, daylight, requestRender });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(14000,14000),new THREE.MeshStandardMaterial({color:0xc7c8b5,roughness:1}));
  ground.rotation.x = -Math.PI/2;
  ground.position.y = -.35;
  ground.receiveShadow = true;
  ground.name = 'Viewer ground';
  scene.add(ground);
  nightscape.registerModel(ground, true);
  setLighting(lighting, false);
  selectView('overview', false);
  document.querySelectorAll('[data-lighting-choice]').forEach(button => button.addEventListener('click', () => setLighting(button.dataset.lightingChoice)));
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => selectView(button.dataset.view)));
  $('#auto-rotate').addEventListener('click', () => {
    tween = null;
    controls.autoRotate = !controls.autoRotate;
    $('#auto-rotate').setAttribute('aria-pressed', String(controls.autoRotate));
    setStatus(controls.autoRotate ? '自动旋转中 · 拖动即可暂停' : '已暂停自动旋转', true);
    requestRender();
  });
  $('#reset').addEventListener('click', () => selectView('overview'));
  $('#hide-ui').addEventListener('click', () => setUIHidden(true));
  $('#show-ui').addEventListener('click', () => setUIHidden(false));
  $('#context-toggle').addEventListener('click', () => {
    contextVisible = !contextVisible;
    if (contextModel) contextModel.visible = contextVisible;
    $('#context-toggle').setAttribute('aria-pressed', String(contextVisible));
    renderer.shadowMap.needsUpdate = true;
    requestRender();
  });
  $('#fullscreen').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { setStatus('当前浏览器不支持全屏，可使用浏览器全屏模式', true); }
  });
  document.addEventListener('fullscreenchange', () => $('#fullscreen').setAttribute('aria-pressed', String(Boolean(document.fullscreenElement))));
  // 视口尺寸统一入口：resize、从后台恢复可见两路触发。
  // 修「页面在 0 尺寸环境里启动 → aspect NaN → 建筑全被视锥裁掉」且
  // 之后没有任何事件会再来救的问题（可见性恢复不触发 resize）
  function refreshViewport() {
    const w = innerWidth, h = innerHeight;
    if (!w || !h) return false; // 仍未拿到布局
    const nowNarrow = w < 650;
    if (nowNarrow !== narrowViewport) {
      tween = null;
      camera.position.sub(controls.target).multiplyScalar(nowNarrow ? mobileDistanceScale(viewKey) : 1/mobileDistanceScale(viewKey)).add(controls.target);
      narrowViewport = nowNarrow;
    }
    camera.aspect = w / h;
    camera.fov = fittedFov(VIEWS[viewKey].fov);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    requestRender();
    return true;
  }
  addEventListener('resize', refreshViewport);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshViewport(); });
  // 个别 webview/后台标签要到首帧后数秒才有真实布局：布局就位前持续重试，
  // 拿到第一个有效尺寸后停止，此后交给 resize/可见性事件接管
  (function awaitLayout(attempt) {
    if (refreshViewport() || attempt <= 0) return;
    setTimeout(() => awaitLayout(attempt - 1), 600);
  })(60);
  addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
    const key = event.key.toLowerCase();
    if (key === 'tab') { event.preventDefault(); setUIHidden(!uiHidden); return; }
    if (!modelReady) return;
    if (/^[1-7]$/.test(key)) selectView(Object.keys(VIEWS)[Number(key)-1]);
    else if (key === 'h') selectView('overview');
    else if (key === 'b') setLighting('day');
    else if (key === 'n') setLighting('night');
    else if (key === ' ' && event.target.tagName !== 'BUTTON') { event.preventDefault(); $('#auto-rotate').click(); }
    else if (['+','=','-','_','arrowup','arrowdown','arrowleft','arrowright'].includes(key)) {
      event.preventDefault(); tween = null; stopRotation();
      const offset = camera.position.clone().sub(controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      if (key === '+' || key === '=') spherical.radius *= .88;
      if (key === '-' || key === '_') spherical.radius *= 1.12;
      if (key === 'arrowleft') spherical.theta -= .08;
      if (key === 'arrowright') spherical.theta += .08;
      if (key === 'arrowup') spherical.phi -= .06;
      if (key === 'arrowdown') spherical.phi += .06;
      spherical.radius = THREE.MathUtils.clamp(spherical.radius, controls.minDistance, controls.maxDistance);
      spherical.phi = THREE.MathUtils.clamp(spherical.phi, controls.minPolarAngle, controls.maxPolarAngle);
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
      requestRender();
    }
  });
  window.__viewer = () => ({ready:modelReady,contextReady,contextVisible,uiHidden,view:viewKey,autoRotate:controls.autoRotate,lighting,lightingBlend:nightscape.blend,modelLoads,nightscape:nightscape.report(),position:camera.position.toArray(),target:controls.target.toArray(),distance:camera.position.distanceTo(controls.target),shadowCoverage:{width:daylight.sun.shadow.camera.right-daylight.sun.shadow.camera.left,height:daylight.sun.shadow.camera.top-daylight.sun.shadow.camera.bottom},environmentIntensity:scene.environmentIntensity,exposure:renderer.toneMappingExposure,sunIntensity:daylight.sun.intensity,fillIntensity:daylight.fill.intensity,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures});
  loadModels().catch(error => {
    console.error('Model loading failed.', error);
    showError('模型载入失败，请检查本地服务后重试。');
  });
}
function showError(message) {
  loading.classList.add('loading-error');
  $('#loading-label').textContent = message;
  $('#retry').hidden = false;
  setStatus('暂时无法显示模型');
}
$('#retry').addEventListener('click', () => location.reload());
try { start(); } catch (error) {
  console.error('Viewer startup failed.', error);
  showError('无法启动三维显示，请开启浏览器硬件加速后重试。');
}
