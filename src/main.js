import * as THREE from "three";

/* ---------- HUD ---------- */
const hpEl = document.getElementById("hp");
const scoreEl = document.getElementById("score");
const ammoEl = document.getElementById("ammo");
const blocker = document.getElementById("blocker");
const playBtn = document.getElementById("playBtn");

let HP = 100;
let SCORE = 0;

function setHUD() {
  hpEl.textContent = HP;
  scoreEl.textContent = SCORE;
  ammoEl.textContent = "∞";
}
setHUD();

/* ---------- THREE SETUP ---------- */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0b0f1a, 12, 70);

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  200
);
camera.position.set(0, 1.6, 6);

/* ---------- LIGHTING ---------- */
scene.add(new THREE.HemisphereLight(0xbad6ff, 0x1b2233, 0.9));

const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(10, 18, 8);
sun.castShadow = true;
scene.add(sun);

/* ---------- GROUND ---------- */
const groundGeo = new THREE.PlaneGeometry(120, 120, 20, 20);
groundGeo.rotateX(-Math.PI / 2);
const pos = groundGeo.attributes.position;

for (let i = 0; i < pos.count; i++) {
  const x = pos.getX(i);
  const z = pos.getZ(i);
  pos.setY(i, (Math.sin(x * 0.18) + Math.cos(z * 0.16)) * 0.25);
}
groundGeo.computeVertexNormals();

const ground = new THREE.Mesh(
  groundGeo,
  new THREE.MeshStandardMaterial({ color: 0x1a2440 })
);
ground.receiveShadow = true;
scene.add(ground);

/* ---------- POINTER LOCK ---------- */
let locked = false;
let yaw = 0;
let pitch = 0;

document.addEventListener("mousemove", (e) => {
  if (!locked) return;
  yaw -= e.movementX * 0.002;
  pitch -= e.movementY * 0.002;
  pitch = Math.max(-1.3, Math.min(1.3, pitch));
});

function lock() {
  renderer.domElement.requestPointerLock();
}

playBtn.onclick = lock;
renderer.domElement.onclick = () => !locked && lock();

document.addEventListener("pointerlockchange", () => {
  locked = document.pointerLockElement === renderer.domElement;
  blocker.style.display = locked ? "none" : "grid";
});

/* ---------- PLAYER ---------- */
const player = {
  pos: new THREE.Vector3(0, 1.6, 6),
  vel: new THREE.Vector3()
};

const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const keys = new Set();

addEventListener("keydown", (e) => keys.add(e.code));
addEventListener("keyup", (e) => keys.delete(e.code));

function move(dt) {
  const speed = keys.has("ShiftLeft") ? 7 : 4.5;

  forward.set(Math.sin(yaw), 0, Math.cos(yaw)).normalize().multiplyScalar(-1);
  right.copy(forward).cross(up);

  let x = 0,
    z = 0;
  if (keys.has("KeyW")) z++;
  if (keys.has("KeyS")) z--;
  if (keys.has("KeyA")) x--;
  if (keys.has("KeyD")) x++;

  const wish = new THREE.Vector3()
    .addScaledVector(forward, z)
    .addScaledVector(right, x)
    .normalize()
    .multiplyScalar(speed);

  player.vel.lerp(wish, 1 - Math.pow(0.001, dt));
  player.pos.addScaledVector(player.vel, dt);

  camera.position.copy(player.pos);
  camera.rotation.set(pitch, yaw, 0, "YXZ");
}

/* ---------- SHOOTING ---------- */
const bullets = [];
const bulletGeo = new THREE.SphereGeometry(0.06, 8, 8);
const bulletMat = new THREE.MeshStandardMaterial({ color: 0xffeaa0 });

addEventListener("mousedown", (e) => {
  if (!locked || e.button !== 0) return;

  const dir = new THREE.Vector3(0, 0, -1)
    .applyEuler(camera.rotation)
    .normalize();

  const b = new THREE.Mesh(bulletGeo, bulletMat);
  b.position.copy(camera.position).addScaledVector(dir, 0.6);
  scene.add(b);

  bullets.push({ mesh: b, dir, life: 1.2 });
});

/* ---------- ENEMIES ---------- */
const enemies = [];
const enemyGeo = new THREE.IcosahedronGeometry(0.65, 0);
const enemyMat = new THREE.MeshStandardMaterial({ color: 0xff4d6d });

function spawnEnemy() {
  const e = new THREE.Mesh(enemyGeo, enemyMat);
  const a = Math.random() * Math.PI * 2;
  const d = 20 + Math.random() * 15;

  e.position.set(
    player.pos.x + Math.cos(a) * d,
    0.8,
    player.pos.z + Math.sin(a) * d
  );

  scene.add(e);
  enemies.push({ mesh: e, hp: 2 });
}

/* ---------- GAME LOOP ---------- */
let spawn = 0;
let last = performance.now();

function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;

  move(dt);

  spawn -= dt;
  if (spawn <= 0) {
    spawnEnemy();
    spawn = 1.2;
  }

  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.life -= dt;
    b.mesh.position.addScaledVector(b.dir, 30 * dt);
    if (b.life <= 0) {
      scene.remove(b.mesh);
      bullets.splice(i, 1);
      continue;
    }

    for (let j = enemies.length - 1; j >= 0; j--) {
      if (b.mesh.position.distanceTo(enemies[j].mesh.position) < 0.7) {
        enemies[j].hp--;
        scene.remove(b.mesh);
        bullets.splice(i, 1);

        if (enemies[j].hp <= 0) {
          SCORE += 10;
          setHUD();
          scene.remove(enemies[j].mesh);
          enemies.splice(j, 1);
        }
        break;
      }
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

/* ---------- RESIZE ---------- */
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
