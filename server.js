import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { WebSocketServer } from "ws";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 10000;

const app = express();

// Serve built Vite output
app.use(express.static(path.join(__dirname, "dist")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ---------- Game constants ----------
const TICK_HZ = 30;
const DT = 1 / TICK_HZ;

const WORLD = {
  minX: -30,
  maxX: 30,
  minZ: -30,
  maxZ: 30
};

// Simple CS2-like blockout: axis-aligned walls/boxes (AABB)
const MAP = {
  // walls are rectangles in XZ, with height assumed
  // each: { x, z, w, d } centered, w=width in X, d=depth in Z
  walls: [
    // Outer boundary walls (thick)
    { x: 0, z: -31, w: 70, d: 2 },
    { x: 0, z: 31,  w: 70, d: 2 },
    { x: -31, z: 0, w: 2,  d: 70 },
    { x: 31,  z: 0, w: 2,  d: 70 },

    // Mid walls to make corridors
    { x: 0, z: 0, w: 2, d: 34 },
    { x: -10, z: -10, w: 22, d: 2 },
    { x: 10, z: 10, w: 22, d: 2 },
    { x: -14, z: 12, w: 2, d: 24 },
    { x: 14, z: -12, w: 2, d: 24 },

    // Site-ish boxes
    { x: -18, z: -18, w: 8, d: 8 },
    { x: 18, z: 18, w: 8, d: 8 },
    { x: 0, z: 18, w: 10, d: 6 },
    { x: 0, z: -18, w: 10, d: 6 }
  ],
  spawns: [
    { x: -24, z: -24 },
    { x: 24,  z: 24 },
    { x: -24, z: 24 },
    { x: 24,  z: -24 }
  ]
};

function randId() {
  return crypto.randomBytes(8).toString("hex");
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// AABB collision check in XZ for a circle player
function circleIntersectsAABB(px, pz, r, box) {
  const minX = box.x - box.w / 2;
  const maxX = box.x + box.w / 2;
  const minZ = box.z - box.d / 2;
  const maxZ = box.z + box.d / 2;

  const cx = clamp(px, minX, maxX);
  const cz = clamp(pz, minZ, maxZ);

  const dx = px - cx;
  const dz = pz - cz;
  return (dx * dx + dz * dz) < (r * r);
}

function resolvePlayerCollisions(p) {
  // push out by simple iterative nudges (cheap but works for blockout)
  for (let iter = 0; iter < 6; iter++) {
    let pushed = false;
    for (const w of MAP.walls) {
      if (circleIntersectsAABB(p.x, p.z, p.r, w)) {
        // push away from wall center
        const dx = p.x - w.x;
        const dz = p.z - w.z;
        const len = Math.hypot(dx, dz) || 1;
        p.x += (dx / len) * 0.12;
        p.z += (dz / len) * 0.12;
        pushed = true;
      }
    }
    if (!pushed) break;
  }

  // world bounds
  p.x = clamp(p.x, WORLD.minX, WORLD.maxX);
  p.z = clamp(p.z, WORLD.minZ, WORLD.maxZ);
}

// ---------- State ----------
const players = new Map(); // id -> player
const bullets = [];        // { id, owner, x,z, vx,vz, life }
const bots = new Map();    // id -> bot

function spawnPoint(i) {
  const s = MAP.spawns[i % MAP.spawns.length];
  return { x: s.x, z: s.z };
}

function makePlayer(id, name = "Player") {
  const sp = spawnPoint(Math.floor(Math.random() * 9999));
  return {
    id,
    name,
    x: sp.x,
    z: sp.z,
    yaw: 0,
    hp: 100,
    score: 0,
    r: 0.55,
    input: { w: 0, a: 0, s: 0, d: 0, shoot: 0, yaw: 0 },
    cooldown: 0
  };
}

function makeBot(id, label = "Bot") {
  const sp = spawnPoint(Math.floor(Math.random() * 9999));
  return {
    id,
    name: label,
    x: sp.x,
    z: sp.z,
    yaw: 0,
    hp: 100,
    r: 0.55,
    cooldown: 0,
    targetId: null,
    wanderT: 0,
    wx: sp.x,
    wz: sp.z
  };
}

function ensureBots(n = 6) {
  while (bots.size < n) {
    const id = "b_" + randId();
    bots.set(id, makeBot(id, "Bot"));
  }
}
ensureBots(6);

// ---------- Shooting ----------
function fireBullet(owner, x, z, yaw) {
  const speed = 22;
  const vx = -Math.sin(yaw) * speed; // forward in -Z rotated by yaw
  const vz = -Math.cos(yaw) * speed;
  bullets.push({
    id: "k_" + randId(),
    owner,
    x,
    z,
    vx,
    vz,
    life: 1.1
  });
}

// hit test bullet vs player circle
function bulletHits(b, p) {
  const dx = b.x - p.x;
  const dz = b.z - p.z;
  return (dx * dx + dz * dz) < ((p.r + 0.12) * (p.r + 0.12));
}

function respawnEntity(ent) {
  const sp = spawnPoint(Math.floor(Math.random() * 9999));
  ent.x = sp.x;
  ent.z = sp.z;
  ent.hp = 100;
}

// ---------- Bot AI ----------
function pickClosestTarget(bot) {
  let best = null;
  let bestD = Infinity;

  for (const p of players.values()) {
    if (p.hp <= 0) continue;
    const dx = p.x - bot.x;
    const dz = p.z - bot.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD) { bestD = d2; best = p; }
  }
  return best;
}

function botThink(bot) {
  const target = pickClosestTarget(bot);
  bot.targetId = target?.id ?? null;

  if (!target) {
    // wander
    bot.wanderT -= DT;
    if (bot.wanderT <= 0) {
      bot.wanderT = 1.5 + Math.random() * 2.5;
      bot.wx = clamp((Math.random() - 0.5) * 50, WORLD.minX, WORLD.maxX);
      bot.wz = clamp((Math.random() - 0.5) * 50, WORLD.minZ, WORLD.maxZ);
    }
    return { moveX: bot.wx - bot.x, moveZ: bot.wz - bot.z, shoot: false, aimYaw: bot.yaw };
  }

  const dx = target.x - bot.x;
  const dz = target.z - bot.z;
  const dist = Math.hypot(dx, dz) || 1;

  const aimYaw = Math.atan2(-dx, -dz); // yaw so forward points to target
  const wantShoot = dist < 16;         // only shoot in range

  // move toward target but not too close
  let moveX = dx;
  let moveZ = dz;
  if (dist < 5.5) { moveX = -dx; moveZ = -dz; }

  return { moveX, moveZ, shoot: wantShoot, aimYaw };
}

// ---------- Networking ----------
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const c of wss.clients) {
    if (c.readyState === 1) c.send(msg);
  }
}

wss.on("connection", (ws) => {
  const id = randId();
  const pl = makePlayer(id);
  players.set(id, pl);

  ws.send(JSON.stringify({
    t: "welcome",
    id,
    map: MAP
  }));

  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(String(data)); } catch { return; }
    const p = players.get(id);
    if (!p) return;

    if (msg.t === "input") {
      p.input = {
        w: msg.w ? 1 : 0,
        a: msg.a ? 1 : 0,
        s: msg.s ? 1 : 0,
        d: msg.d ? 1 : 0,
        shoot: msg.shoot ? 1 : 0,
        yaw: Number(msg.yaw) || 0
      };
    }
  });

  ws.on("close", () => {
    players.delete(id);
  });
});

// ---------- Game loop ----------
setInterval(() => {
  // keep bots alive
  ensureBots(6);

  // update players
  for (const p of players.values()) {
    if (p.hp <= 0) {
      respawnEntity(p);
    }

    p.yaw = p.input.yaw;

    const speed = 5.2;
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    const rx = -fz;
    const rz = fx;

    let mx = 0, mz = 0;
    if (p.input.w) { mx += fx; mz += fz; }
    if (p.input.s) { mx -= fx; mz -= fz; }
    if (p.input.d) { mx += rx; mz += rz; }
    if (p.input.a) { mx -= rx; mz -= rz; }

    const len = Math.hypot(mx, mz);
    if (len > 0.001) {
      mx /= len; mz /= len;
      p.x += mx * speed * DT;
      p.z += mz * speed * DT;
      resolvePlayerCollisions(p);
    }

    p.cooldown = Math.max(0, p.cooldown - DT);
    if (p.input.shoot && p.cooldown <= 0) {
      p.cooldown = 0.12; // fire rate
      fireBullet(p.id, p.x, p.z, p.yaw);
    }
  }

  // update bots
  for (const b of bots.values()) {
    if (b.hp <= 0) respawnEntity(b);

    const ai = botThink(b);
    b.yaw = ai.aimYaw;

    // move
    const speed = 4.2;
    let mx = ai.moveX;
    let mz = ai.moveZ;
    const len = Math.hypot(mx, mz);
    if (len > 0.001) {
      mx /= len; mz /= len;
      b.x += mx * speed * DT;
      b.z += mz * speed * DT;
      resolvePlayerCollisions(b);
    }

    // shoot
    b.cooldown = Math.max(0, b.cooldown - DT);
    if (ai.shoot && b.cooldown <= 0) {
      b.cooldown = 0.18;
      fireBullet(b.id, b.x, b.z, b.yaw);
    }
  }

  // update bullets + hits
  for (let i = bullets.length - 1; i >= 0; i--) {
    const k = bullets[i];
    k.life -= DT;
    k.x += k.vx * DT;
    k.z += k.vz * DT;

    // hit walls: if inside any wall AABB (treat bullet as point)
    let hitWall = false;
    for (const w of MAP.walls) {
      const minX = w.x - w.w / 2, maxX = w.x + w.w / 2;
      const minZ = w.z - w.d / 2, maxZ = w.z + w.d / 2;
      if (k.x >= minX && k.x <= maxX && k.z >= minZ && k.z <= maxZ) { hitWall = true; break; }
    }

    if (hitWall || k.life <= 0) {
      bullets.splice(i, 1);
      continue;
    }

    // check hit players
    for (const p of players.values()) {
      if (p.id === k.owner) continue;
      if (bulletHits(k, p)) {
        p.hp -= 25;
        if (p.hp <= 0) {
          const killer = players.get(k.owner);
          if (killer) killer.score += 1;
        }
        bullets.splice(i, 1);
        break;
      }
    }
    // check hit bots
    for (const b of bots.values()) {
      if (b.id === k.owner) continue;
      if (bulletHits(k, b)) {
        b.hp -= 25;
        bullets.splice(i, 1);
        break;
      }
    }
  }

  // broadcast snapshot
  broadcast({
    t: "state",
    players: Array.from(players.values()).map(p => ({
      id: p.id, name: p.name, x: p.x, z: p.z, yaw: p.yaw, hp: p.hp, score: p.score
    })),
    bots: Array.from(bots.values()).map(b => ({
      id: b.id, name: b.name, x: b.x, z: b.z, yaw: b.yaw, hp: b.hp
    })),
    bullets: bullets.map(k => ({ id: k.id, owner: k.owner, x: k.x, z: k.z }))
  });
}, 1000 / TICK_HZ);

server.listen(PORT, () => {
  console.log("Server listening on", PORT);
});
