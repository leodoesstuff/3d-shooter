import * as THREE from "three";

const hpEl = document.getElementById("hp");
const scoreEl = document.getElementById("score");
const weaponEl = document.getElementById("weapon");
const blocker = document.getElementById("blocker");
const playBtn = document.getElementById("playBtn");

let myId = null;
let HP = 120;
let SCORE = 0;

function setHUD() {
  hpEl.textContent = String(Math.max(0, Math.floor(HP)));
  scoreEl.textContent = String(SCORE);
}
setHUD();

function weaponLabel(w) {
  if (w === "pistol") return "PISTOL";
  if (w === "smg") return "SMG";
  if (w === "rifle") return "RIFLE";
  if (w === "sniper") return "SNIPER";
  return "RIFLE";
}

// ---------- Three ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.shadowMap.enabled = true;

// more “realistic” tone
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;

document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x070a12, 10, 110);
scene.background = new THREE.Color(0x070a12);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 260);
camera.position.set(0, 1.6, 6);

// Lighting (strong key + fill)
scene.add(new THREE.HemisphereLight(0xaac8ff, 0x060813, 0.75));

const sun = new THREE.DirectionalLight(0xffffff, 1.35);
sun.position.set(18, 28, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -60;
sun.shadow.camera.right = 60;
sun.shadow.camera.top = 60;
sun.shadow.camera.bottom = -60;
scene.add(sun);

// subtle rim light
const rim = new THREE.DirectionalLight(0xbad6ff, 0.25);
rim.position.set(-14, 10, -20);
scene.add(rim);

// Ground with darker material
const groundGeo = new THREE.PlaneGeometry(140, 140, 24, 24);
groundGeo.rotateX(-Math.PI / 2);
const groundPos = groundGeo.attributes.position;
for (let i = 0; i < groundPos.count; i++) {
  const x = groundPos.getX(i);
  const z = groundPos.getZ(i);
  groundPos.setY(i, (Math.sin(x * 0.14) + Math.cos(z * 0.13)) * 0.22);
}
groundGeo.computeVertexNormals();

const ground = new THREE.Mesh(
  groundGeo,
  new THREE.MeshStandardMaterial({ color: 0x0f1424, roughness: 1, metalness: 0 })
);
ground.receiveShadow = true;
scene.add(ground);

// ---------- Pointer lock look ----------
let locked = false;
let yaw = 0;
let pitch = 0;

document.addEventListener("mousemove", (e) => {
  if (!locked) return;
  const sens = 0.0021;
  yaw -= e.movementX * sens;
  pitch -= e.movementY * sens;
  pitch = Math.max(-1.25, Math.min(1.25, pitch));
});

function lockPointer() { renderer.domElement.requestPointerLock(); }
playBtn.addEventListener("click", lockPointer);
renderer.domElement.addEventListener("click", () => { if (!locked) lockPointer(); });

document.addEventListener("pointerlockchange", () => {
  locked = document.pointerLockElement === renderer.domElement;
  blocker.style.display = locked ? "none" : "grid";
});

// ---------- Input ----------
const keys = new Set();
let mouseDown = false;
let resetPressed = false;

let currentWeapon = "rifle";
weaponEl.textContent = weaponLabel(currentWeapon);

addEventListener("keydown", (e) => {
  keys.add(e.code);

  if (e.code === "Digit1") currentWeapon = "pistol";
  if (e.code === "Digit2") currentWeapon = "smg";
  if (e.code === "Digit3") currentWeapon = "rifle";
  if (e.code === "Digit4") currentWeapon = "sniper";
  if (e.code === "KeyR") resetPressed = true;

  weaponEl.textContent = weaponLabel(currentWeapon);
  rebuildGun(currentWeapon);
});

addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("mousedown", (e) => { if (e.button === 0) mouseDown = true; });
addEventListener("mouseup", (e) => { if (e.button === 0) mouseDown = false; });

// ---------- Viewmodel gun (different per weapon) ----------
const gunRoot = new THREE.Group();
camera.add(gunRoot);
scene.add(camera);

const MAT_GUN = new THREE.MeshStandardMaterial({ color: 0x1b2436, roughness: 0.35, metalness: 0.35 });
const MAT_DARK = new THREE.MeshStandardMaterial({ color: 0x0f141f, roughness: 0.4, metalness: 0.45 });
const MAT_ACCENT = new THREE.MeshStandardMaterial({ color: 0x2a6bff, roughness: 0.45, metalness: 0.15 });

let muzzleFlash = null;
let flashT = 0;

function clearGun() {
  for (let i = gunRoot.children.length - 1; i >= 0; i--) gunRoot.remove(gunRoot.children[i]);
  muzzleFlash = null;
}

function addFlash(pos) {
  muzzleFlash = new THREE.Mesh(
    new THREE.SphereGeometry(0.085, 10, 10),
    new THREE.MeshStandardMaterial({ color: 0xfff2b0, emissive: 0xffdd66, emissiveIntensity: 2 })
  );
  muzzleFlash.position.copy(pos);
  muzzleFlash.visible = false;
  gunRoot.add(muzzleFlash);
}

function rebuildGun(type) {
  clearGun();

  // Shared placement
  gunRoot.position.set(0, 0, 0);

  if (type === "pistol") {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.34), MAT_GUN);
    body.position.set(0.22, -0.25, -0.62);

    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.08, 0.26), MAT_DARK);
    slide.position.set(0.22, -0.32, -0.66);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.14, 0.12), MAT_DARK);
    grip.position.set(0.20, -0.38, -0.58);
    grip.rotation.x = 0.15;

    gunRoot.add(body, slide, grip);
    addFlash(new THREE.Vector3(0.22, -0.30, -0.82));
  }

  if (type === "smg") {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.52), MAT_GUN);
    body.position.set(0.26, -0.25, -0.70);

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.42, 10), MAT_DARK);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0.26, -0.22, -0.98);

    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.10), MAT_DARK);
    mag.position.set(0.23, -0.40, -0.70);

    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.10, 0.22), MAT_ACCENT);
    stock.position.set(0.18, -0.28, -0.48);

    gunRoot.add(body, barrel, mag, stock);
    addFlash(new THREE.Vector3(0.26, -0.22, -1.18));
  }

  if (type === "rifle") {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.62), MAT_GUN);
    body.position.set(0.28, -0.26, -0.74);

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.60, 10), MAT_DARK);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0.28, -0.22, -1.14);

    const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.26), MAT_DARK);
    handguard.position.set(0.28, -0.30, -0.98);

    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.18, 0.12), MAT_DARK);
    mag.position.set(0.24, -0.42, -0.78);

    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.12, 0.26), MAT_ACCENT);
    stock.position.set(0.20, -0.30, -0.52);

    gunRoot.add(body, barrel, handguard, mag, stock);
    addFlash(new THREE.Vector3(0.28, -0.22, -1.44));
  }

  if (type === "sniper") {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.16, 0.70), MAT_GUN);
    body.position.set(0.30, -0.26, -0.78);

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.82, 10), MAT_DARK);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0.30, -0.22, -1.28);

    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 12), MAT_DARK);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0.30, -0.35, -0.84);

    const scopeMount = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.04, 0.12), MAT_ACCENT);
    scopeMount.position.set(0.30, -0.31, -0.84);

    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.28), MAT_ACCENT);
    stock.position.set(0.20, -0.30, -0.54);

    gunRoot.add(body, barrel, scope, scopeMount, stock);
    addFlash(new THREE.Vector3(0.30, -0.22, -1.70));
  }
}

rebuildGun(currentWeapon);

// ---------- Models: player/bot (humanoid-ish) ----------
function makeHumanoid(material, accentMaterial) {
  const g = new THREE.Group();

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.25), material);
  torso.position.set(0, 1.05, 0);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.20, 14, 14), material);
  head.position.set(0, 1.45, 0);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.215, 14, 14), accentMaterial);
  helmet.position.set(0, 1.45, 0);
  helmet.scale.set(1, 0.85, 1);

  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.55, 0.22), material);
  legs.position.set(0, 0.60, 0);

  const arms = new THREE.Mesh(new THREE.BoxGeometry(0.70, 0.14, 0.20), material);
  arms.position.set(0, 1.05, 0);
  arms.rotation.z = 0.05;

  // gun proxy for 3rd-person
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.10, 0.30), accentMaterial);
  gun.position.set(0.30, 1.00, -0.10);
  gun.rotation.y = Math.PI;

  g.add(torso, head, helmet, legs, arms, gun);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

const MAT_OTHER = new THREE.MeshStandardMaterial({ color: 0x57a1ff, roughness: 0.65, metalness: 0.1 });
const MAT_OTHER_ACCENT = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.6, metalness: 0.05 });

const MAT_BOT = new THREE.MeshStandardMaterial({ color: 0xff4d6d, roughness: 0.85, metalness: 0.05 });
const MAT_BOT_ACCENT = new THREE.MeshStandardMaterial({ color: 0x7f1d1d, roughness: 0.9, metalness: 0.0 });

const MAT_WALL = new THREE.MeshStandardMaterial({ color: 0x2a3c66, roughness: 0.95, metalness: 0 });

// ---------- Networking ----------
const wsProto = location.protocol === "https:" ? "wss" : "ws";
const ws = new WebSocket(`${wsProto}://${location.host}`);

let mapBuilt = false;
const others = new Map();     // id -> Group
const botMeshes = new Map();  // id -> Group
const bulletMeshes = new Map();

function buildMap(map) {
  for (const w of map.walls) {
    const geo = new THREE.BoxGeometry(w.w, 3, w.d);
    const m = new THREE.Mesh(geo, MAT_WALL);
    m.position.set(w.x, 1.5, w.z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  }

  // some props
  for (let i = 0; i < 26; i++) {
    const ww = 0.8 + Math.random() * 2.0;
    const hh = 0.7 + Math.random() * 2.4;
    const dd = 0.8 + Math.random() * 2.0;
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(ww, hh, dd),
      new THREE.MeshStandardMaterial({ color: 0x2f4b86, roughness: 0.9, metalness: 0 })
    );
    box.position.set((Math.random() - 0.5) * 45, hh / 2, (Math.random() - 0.5) * 45);
    box.castShadow = true;
    box.receiveShadow = true;
    scene.add(box);
  }

  mapBuilt = true;
}

let serverSprinting = 0;

ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);

  if (msg.t === "welcome") {
    myId = msg.id;
    if (!mapBuilt) buildMap(msg.map);
  }

  if (msg.t === "state") {
    // players
    const seenPlayers = new Set();
    for (const p of msg.players) {
      seenPlayers.add(p.id);

      if (p.id === myId) {
        HP = p.hp;
        SCORE = p.score;
        setHUD();

        if (p.weapon) {
          weaponEl.textContent = weaponLabel(p.weapon);
        }
        serverSprinting = p.sprint ? 1 : 0;

        camera.position.lerp(new THREE.Vector3(p.x, 1.6, p.z), 0.45);
        camera.rotation.set(pitch, yaw, 0, "YXZ");
        continue;
      }

      let model = others.get(p.id);
      if (!model) {
        model = makeHumanoid(MAT_OTHER, MAT_OTHER_ACCENT);
        scene.add(model);
        others.set(p.id, model);
      }

      model.position.lerp(new THREE.Vector3(p.x, 0, p.z), 0.6);
      model.rotation.y = p.yaw;
    }

    for (const [id, m] of others) {
      if (!seenPlayers.has(id)) {
        scene.remove(m);
        others.delete(id);
      }
    }

    // bots
    const seenBots = new Set();
    for (const b of msg.bots) {
      seenBots.add(b.id);

      let model = botMeshes.get(b.id);
      if (!model) {
        model = makeHumanoid(MAT_BOT, MAT_BOT_ACCENT);
        scene.add(model);
        botMeshes.set(b.id, model);
      }

      model.position.lerp(new THREE.Vector3(b.x, 0, b.z), 0.6);
      model.rotation.y = b.yaw;
    }

    for (const [id, m] of botMeshes) {
      if (!seenBots.has(id)) {
        scene.remove(m);
        botMeshes.delete(id);
      }
    }

    // bullets
    const seenBullets = new Set();
    for (const k of msg.bullets) {
      seenBullets.add(k.id);
      let bm = bulletMeshes.get(k.id);
      if (!bm) {
        bm = new THREE.Mesh(
          new THREE.SphereGeometry(0.07, 10, 10),
          new THREE.MeshStandardMaterial({ color: 0xffeaa0, roughness: 0.6, metalness: 0.1 })
        );
        bm.castShadow = true;
        scene.add(bm);
        bulletMeshes.set(k.id, bm);
      }
      bm.position.set(k.x, 1.25, k.z);
    }

    for (const [id, bm] of bulletMeshes) {
      if (!seenBullets.has(id)) {
        scene.remove(bm);
        bulletMeshes.delete(id);
      }
    }
  }
});

// ---------- Send input ----------
setInterval(() => {
  if (ws.readyState !== 1) return;

  const shooting = locked && mouseDown;
  const sprint = locked && keys.has("ShiftLeft") && (keys.has("KeyW") || keys.has("KeyA") || keys.has("KeyD"));

  if (shooting && muzzleFlash) flashT = 0.05;

  ws.send(JSON.stringify({
    t: "input",
    w: keys.has("KeyW"),
    a: keys.has("KeyA"),
    s: keys.has("KeyS"),
    d: keys.has("KeyD"),
    shoot: shooting,
    yaw,
    weapon: currentWeapon,
    reset: resetPressed,
    sprint
  }));
  resetPressed = false;
}, 1000 / 30);

// ---------- Render loop (bob + sprint FOV) ----------
let last = performance.now();
let bobT = 0;

const baseFov = 75;
const sprintFov = 82;

function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;

  const moving = keys.has("KeyW") || keys.has("KeyA") || keys.has("KeyS") || keys.has("KeyD");
  const sprinting = !!serverSprinting;

  // camera FOV sprint kick
  const targetFov = sprinting ? sprintFov : baseFov;
  camera.fov += (targetFov - camera.fov) * (1 - Math.pow(0.001, dt));
  camera.updateProjectionMatrix();

  // viewmodel bob/sway
  bobT += dt * (moving ? (sprinting ? 14 : 10) : 3);

  gunRoot.position.x = Math.sin(bobT) * (moving ? 0.02 : 0.006);
  gunRoot.position.y = Math.abs(Math.cos(bobT)) * (moving ? 0.02 : 0.006);

  // a bit of sway from look
  gunRoot.rotation.y = THREE.MathUtils.clamp(-yaw * 0.03, -0.12, 0.12);
  gunRoot.rotation.x = THREE.MathUtils.clamp(pitch * 0.05, -0.10, 0.10);

  // muzzle flash fade
  flashT = Math.max(0, flashT - dt);
  if (muzzleFlash) muzzleFlash.visible = flashT > 0;

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
