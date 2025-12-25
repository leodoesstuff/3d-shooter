import * as THREE from "three";

const hpEl = document.getElementById("hp");
const scoreEl = document.getElementById("score");
const ammoEl = document.getElementById("ammo");
const blocker = document.getElementById("blocker");
const playBtn = document.getElementById("playBtn");

let myId = null;
let HP = 100;
let SCORE = 0;

function setHUD() {
  hpEl.textContent = String(Math.max(0, Math.floor(HP)));
  scoreEl.textContent = String(SCORE);
  ammoEl.textContent = "∞";
}
setHUD();

// ---------- Three.js ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0b0f1a, 12, 90);
scene.background = new THREE.Color(0x0b0f1a);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 250);
camera.position.set(0, 1.6, 6);

scene.add(new THREE.HemisphereLight(0xbad6ff, 0x1b2233, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(10, 18, 8);
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
  new THREE.MeshStandardMaterial({ color: 0x1a2440, roughness: 1 })
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

addEventListener("keydown", (e) => keys.add(e.code));
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("mousedown", (e) => { if (e.button === 0) mouseDown = true; });
addEventListener("mouseup", (e) => { if (e.button === 0) mouseDown = false; });

// ---------- Networking ----------
const wsProto = location.protocol === "https:" ? "wss" : "ws";
const ws = new WebSocket(`${wsProto}://${location.host}`);

let mapBuilt = false;
let wallMeshes = [];

const others = new Map(); // id -> mesh
const bots = new Map();   // id -> mesh
const bulletMeshes = new Map(); // id -> mesh

const matWall = new THREE.MeshStandardMaterial({ color: 0x2c3f6a, roughness: 0.95 });
const matMe = new THREE.MeshStandardMaterial({ color: 0x4cffb2, roughness: 0.7 });
const matOther = new THREE.MeshStandardMaterial({ color: 0x57a1ff, roughness: 0.7 });
const matBot = new THREE.MeshStandardMaterial({ color: 0xff4d6d, roughness: 0.85 });
const matBullet = new THREE.MeshStandardMaterial({ color: 0xffeaa0, roughness: 0.6 });

function buildMap(map) {
  // walls
  for (const w of map.walls) {
    const geo = new THREE.BoxGeometry(w.w, 3, w.d);
    const m = new THREE.Mesh(geo, matWall);
    m.position.set(w.x, 1.5, w.z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    wallMeshes.push(m);
  }

  // some extra props for vibes (client-only)
  for (let i = 0; i < 18; i++) {
    const w = 0.8 + Math.random() * 1.6;
    const h = 0.6 + Math.random() * 1.8;
    const d = 0.8 + Math.random() * 1.6;
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: 0x334a7a, roughness: 0.9 }));
    box.position.set((Math.random() - 0.5) * 45, h / 2, (Math.random() - 0.5) * 45);
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
    const seen = new Set();
    for (const p of msg.players) {
      seen.add(p.id);

      if (p.id === myId) {
        HP = p.hp;
        SCORE = p.score;
        setHUD();

        // camera follows server position (smoothly)
        camera.position.lerp(new THREE.Vector3(p.x, 1.6, p.z), 0.4);
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

    // cleanup disconnected players
    for (const [id, m] of others) {
      if (!seen.has(id)) {
        scene.remove(m);
        others.delete(id);
      }
    }

    // bots
    const seenBots = new Set();
    for (const b of msg.bots) {
      seenBots.add(b.id);
      let mesh = bots.get(b.id);
      if (!mesh) {
        mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.75, 0), matBot);
        mesh.castShadow = true;
        scene.add(mesh);
        bots.set(b.id, mesh);
      }
      mesh.position.lerp(new THREE.Vector3(b.x, 0.8, b.z), 0.6);
      mesh.rotation.y = b.yaw;
    }
    for (const [id, m] of bots) {
      if (!seenBots.has(id)) {
        scene.remove(m);
        bots.delete(id);
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
  ws.send(JSON.stringify({
    t: "input",
    w: keys.has("KeyW"),
    a: keys.has("KeyA"),
    s: keys.has("KeyS"),
    d: keys.has("KeyD"),
    shoot: locked && mouseDown,
    yaw
  }));
}, 1000 / 30);

// simple camera feel even before first state
function renderLoop() {
  renderer.render(scene, camera);
  requestAnimationFrame(renderLoop);
}
requestAnimationFrame(renderLoop);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
