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

// shooter-ish look
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;

document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x070a12, 10, 95);
scene.background = new THREE.Color(0x070a12);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 260);
camera.position.set(0, 1.6, 6);

// lights
scene.add(new THREE.HemisphereLight(0xbad6ff, 0x0b1020, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.25);
sun.position.set(12, 22, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);

// ground
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
  new THREE.MeshStandardMaterial({ color: 0x121a2f, roughness: 1, metalness: 0 })
);
ground.receiveShadow = true;
scene.add(ground);

// ---------- Viewmodel gun + muzzle flash ----------
const gun = new THREE.Group();
const gunMat = new THREE.MeshStandardMaterial({ color: 0x1b2436, roughness: 0.35, metalness: 0.35 });
const gunDark = new THREE.MeshStandardMaterial({ color: 0x0f141f, roughness: 0.4, metalness: 0.4 });

const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.56), gunMat);
gunBody.position.set(0.26, -0.25, -0.68);

const gunTop = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.10, 0.30), gunDark);
gunTop.position.set(0.26, -0.33, -0.74);

const gunBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.35, 10), gunDark);
gunBarrel.rotation.x = Math.PI / 2;
gunBarrel.position.set(0.26, -0.23, -0.98);

const flash = new THREE.Mesh(
  new THREE.SphereGeometry(0.085, 10, 10),
  new THREE.MeshStandardMaterial({ color: 0xfff2b0, emissive: 0xffdd66, emissiveIntensity: 2 })
);
flash.position.set(0.26, -0.23, -1.12);
flash.visible = false;

gun.add(gunBody, gunTop, gunBarrel, flash);
camera.add(gun);
scene.add(camera);

let flashT = 0;
let bobT = 0;

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
});

addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("mousedown", (e) => { if (e.button === 0) mouseDown = true; });
addEventListener("mouseup", (e) => { if (e.button === 0) mouseDown = false; });

// ---------- Networking ----------
const wsProto = location.protocol === "https:" ? "wss" : "ws";
const ws = new WebSocket(`${wsProto}://${location.host}`);

let mapBuilt = false;
const wallMeshes = [];

const others = new Map(); // id -> mesh
const botMeshes = new Map(); // id -> mesh
const bulletMeshes = new Map(); // id -> mesh

const matWall = new THREE.MeshStandardMaterial({ color: 0x2a3c66, roughness: 0.95, metalness: 0 });
const matOther = new THREE.MeshStandardMaterial({ color: 0x57a1ff, roughness: 0.65, metalness: 0.1 });
const matBot = new THREE.MeshStandardMaterial({ color: 0xff4d6d, roughness: 0.85, metalness: 0.05 });
const matBullet = new THREE.MeshStandardMaterial({ color: 0xffeaa0, roughness: 0.6, metalness: 0.1 });

function buildMap(map) {
  for (const w of map.walls) {
    const geo = new THREE.BoxGeometry(w.w, 3, w.d);
    const m = new THREE.Mesh(geo, matWall);
    m.position.set(w.x, 1.5, w.z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    wallMeshes.push(m);
  }

  // extra props for vibes
  for (let i = 0; i < 22; i++) {
    const ww = 0.8 + Math.random() * 1.8;
    const hh = 0.7 + Math.random() * 2.1;
    const dd = 0.8 + Math.random() * 1.8;
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

        // snap weapon name if server sends it
        if (p.weapon) weaponEl.textContent = weaponLabel(p.weapon);

        // move camera toward server position
        camera.position.lerp(new THREE.Vector3(p.x, 1.6, p.z), 0.45);
        camera.rotation.set(pitch, yaw, 0, "YXZ");
        continue;
      }

      let mesh = others.get(p.id);
      if (!mesh) {
        mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.8, 6, 10), matOther);
        mesh.castShadow = true;
        scene.add(mesh);
        others.set(p.id, mesh);
      }
      mesh.position.lerp(new THREE.Vector3(p.x, 1.05, p.z), 0.6);
      mesh.rotation.y = p.yaw;
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
      let mesh = botMeshes.get(b.id);
      if (!mesh) {
        mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.75, 0), matBot);
        mesh.castShadow = true;
        scene.add(mesh);
        botMeshes.set(b.id, mesh);
      }
      mesh.position.lerp(new THREE.Vector3(b.x, 0.8, b.z), 0.6);
      mesh.rotation.y = b.yaw;
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
        bm = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), matBullet);
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

// send input at 30hz
setInterval(() => {
  if (ws.readyState !== 1) return;

  const shooting = locked && mouseDown;

  // muzzle flash + small kick feel
  if (shooting) {
    flashT = 0.05;
  }

  ws.send(JSON.stringify({
    t: "input",
    w: keys.has("KeyW"),
    a: keys.has("KeyA"),
    s: keys.has("KeyS"),
    d: keys.has("KeyD"),
    shoot: shooting,
    yaw,
    weapon: currentWeapon,
    reset: resetPressed
  }));
  resetPressed = false;
}, 1000 / 30);

// render loop
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;

  // viewmodel bobbing
  const moving = keys.has("KeyW") || keys.has("KeyA") || keys.has("KeyS") || keys.has("KeyD");
  bobT += dt * (moving ? 10 : 3);
  gun.position.x = Math.sin(bobT) * (moving ? 0.02 : 0.006);
  gun.position.y = Math.abs(Math.cos(bobT)) * (moving ? 0.02 : 0.006);

  flashT = Math.max(0, flashT - dt);
  flash.visible = flashT > 0;

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
