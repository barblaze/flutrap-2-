'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
//  CONSTANTES DE FÍSICA  (todas en px/s y px/s² — se escalan con deltaTime)
// ═══════════════════════════════════════════════════════════════════════════════
const CS        = 24;
const PLAYER_W  = 18;
const PLAYER_H  = 20;

const GRAVITY   = 1980;     // px/s²
const JUMP_VEL  = -690;     // px/s
const MOVE_ACC  = 6480;     // px/s²
const MOVE_SPD  = 204;      // px/s
const FRIC_AIR  = 0.0045;   // fricción en el aire  (≈ 0.78^60 /s)
const FRIC_GND  = 0.00001;  // fricción en suelo — freno casi instantáneo
const MAX_FALL  = 1080;     // px/s

// Coyote time: ventana tras salir de un borde donde aún puedes saltar
const COYOTE_TIME   = 0.09; // s
// Jump buffer: ventana antes de tocar suelo donde se pre-registra el salto
const JUMP_BUFFER   = 0.10; // s

const DEATH_DUR     = 1.0;
const INVIN_DUR     = 1.333;
const GRAV_DUR      = 3.0;
const FLASH_DUR     = 0.133;
const MSG_DUR       = 2.2;

const TARGET_DT     = 1 / 60;
const MAX_DT        = 1 / 20;

// ─── TILE IDs ─────────────────────────────────────────────────────────────────
// 0=vacío  1=sólido  3=pico_activo  4=pico_oculto  5=fake(caída)
// 6=ghost  7=gravity  8=salida
const T_EMPTY  = 0;
const T_SOLID  = 1;
const T_SPIKE  = 3;
const T_HSPIKE = 4;
const T_FAKE   = 5;
const T_GHOST  = 6;
const T_GRAV   = 7;
const T_EXIT   = 8;

// ═══════════════════════════════════════════════════════════════════════════════
//  PALETA Y MENSAJES
// ═══════════════════════════════════════════════════════════════════════════════
const PAL = {
  bg:'#04060f', floor:'#0e2030', floorG:'#1a3a50', steel:'#1a2a3a',
  spike:'#ff3040', spikeG:'#ff8090', ghost:'rgba(40,180,120,.45)',
  fake:'rgba(100,80,160,.5)', exit:'#00ffcc', grav:'#ff00aa',
  player:'#e0f0ff', eye:'#00ffcc', pupil:'#003020',
};

const TAUNTS = [
  'NICE TRY','SKILL ISSUE','PATHETIC','THAT WAS OBVIOUS','LOL',
  'ARE YOU EVEN TRYING?','PREDICTED','L RATIO','STILL ALIVE?','TOUCH GRASS',
  'JUST STOP','PAIN IS INFORMATION','COPE','YOU FOOL','CLASSIC',
  'MAYBE PLAY EASIER','WOW...','BRUH','GET GOOD',
];

// ═══════════════════════════════════════════════════════════════════════════════
//  AUDIO
// ═══════════════════════════════════════════════════════════════════════════════
const AudioCtxCls = window.AudioContext || window.webkitAudioContext;
let actx = null;
function initAudio() { if (!actx) actx = new AudioCtxCls(); }

function sfx(type) {
  try {
    if (!actx) return;
    const g = actx.createGain(), o = actx.createOscillator();
    o.connect(g); g.connect(actx.destination);
    const t = actx.currentTime;
    switch (type) {
      case 'jump':
        o.type='square'; o.frequency.setValueAtTime(220,t);
        o.frequency.exponentialRampToValueAtTime(440,t+.08);
        g.gain.setValueAtTime(.18,t); g.gain.exponentialRampToValueAtTime(.001,t+.12);
        o.start(t); o.stop(t+.12); break;
      case 'die':
        o.type='sawtooth'; o.frequency.setValueAtTime(440,t);
        o.frequency.exponentialRampToValueAtTime(55,t+.35);
        g.gain.setValueAtTime(.25,t); g.gain.exponentialRampToValueAtTime(.001,t+.35);
        o.start(t); o.stop(t+.35); break;
      case 'trap':
        o.type='square'; o.frequency.setValueAtTime(880,t);
        o.frequency.exponentialRampToValueAtTime(110,t+.15);
        g.gain.setValueAtTime(.2,t); g.gain.exponentialRampToValueAtTime(.001,t+.15);
        o.start(t); o.stop(t+.15); break;
      case 'win':
        o.type='triangle'; o.frequency.setValueAtTime(440,t);
        o.frequency.linearRampToValueAtTime(880,t+.1);
        o.frequency.linearRampToValueAtTime(1760,t+.2);
        g.gain.setValueAtTime(.22,t); g.gain.exponentialRampToValueAtTime(.001,t+.3);
        o.start(t); o.stop(t+.3); break;
      case 'troll':
        o.type='sine'; o.frequency.setValueAtTime(660,t);
        o.frequency.exponentialRampToValueAtTime(220,t+.4);
        g.gain.setValueAtTime(.2,t); g.gain.setValueAtTime(.2,t+.35);
        g.gain.exponentialRampToValueAtTime(.001,t+.5);
        o.start(t); o.stop(t+.5); break;
      case 'land':
        o.type='square'; o.frequency.setValueAtTime(120,t);
        o.frequency.exponentialRampToValueAtTime(60,t+.05);
        g.gain.setValueAtTime(.12,t); g.gain.exponentialRampToValueAtTime(.001,t+.06);
        o.start(t); o.stop(t+.06); break;
    }
  } catch(e) {}
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function _rnd(a) { return a[Math.floor(Math.random() * a.length)]; }

// AABB overlap test — usado por entidades FSM
function _aabb(ax,ay,aw,ah,bx,by,bw,bh) {
  return ax < bx+bw && ax+aw > bx && ay < by+bh && ay+ah > by;
}

// ═══════════════════════════════════════════════════════════════════════════════
//
//  FSM — MÁQUINA DE ESTADOS FINITA PARA ENTIDADES DE TRAMPA
//
//   ┌────────┐  sensor activo   ┌───────────┐  triggerDelay  ┌───────────┐
//   │  IDLE  │ ───────────────► │ TRIGGERED │ ─────────────► │ ANIMATING │
//   └────────┘                  └───────────┘                └─────┬─────┘
//        ▲                                                          │  done
//        │  resetDelay >= 0                                         ▼
//        └──────────────────────────────────────────────────  ┌───────────┐
//                                                             │   RESET   │
//                                                             └───────────┘
//  Hooks que implementa cada subclase:
//    onTrigger(game)      — efecto inicial
//    onUpdate(dt, game)   — lógica/frame; devuelve true al terminar
//    onReset(game)        — restaura el tile/estado original
//    onDraw(ctx, game)    — render custom
//
// ═══════════════════════════════════════════════════════════════════════════════

const FSM = Object.freeze({ IDLE:0, TRIGGERED:1, ANIMATING:2, RESET:3 });

class Entity {
  constructor(def) {
    this.id           = def.id;
    this.type         = def.type;
    this.col          = def.col   ?? 0;
    this.row          = def.row   ?? 0;
    this.trigger      = def.trigger      ?? null;
    this.triggerDelay = def.triggerDelay ?? 0.05;
    this.resetDelay   = def.resetDelay   ?? -1;   // -1 = no se recicla
    this.oneShot      = def.oneShot      ?? true;

    this.x     = this.col * CS;
    this.y     = this.row * CS;
    this.state = FSM.IDLE;
    this.timer = 0;
    this._dead = false;
  }

  update(dt, game) {
    // BUG-FIX #1: sensor nunca se evalúa sin jugador vivo
    if (!game.state.player) return;

    switch (this.state) {
      case FSM.IDLE:
        if (this.trigger && this._sensorActive(game)) {
          this.state = FSM.TRIGGERED;
          this.timer = 0;
          this.onTrigger(game);
          // BUG-FIX #2: sfx('trap') sólo si la entidad tiene efecto auditivo propio
          // Cada subclase llama sfx() en onTrigger para control granular
        }
        break;

      case FSM.TRIGGERED:
        this.timer += dt;
        if (this.timer >= this.triggerDelay) {
          this.state = FSM.ANIMATING;
          this.timer = 0;
        }
        break;

      case FSM.ANIMATING:
        this.timer += dt;
        if (this.onUpdate(dt, game)) {
          if (this.resetDelay < 0) {
            this._dead = true;
          } else {
            this.state = FSM.RESET;
            this.timer = 0;
          }
        }
        break;

      case FSM.RESET:
        this.timer += dt;
        if (this.timer >= Math.max(this.resetDelay, 0)) {
          this.onReset(game);
          if (this.oneShot) {
            this._dead = true;
          } else {
            this.state = FSM.IDLE;
            this.timer = 0;
          }
        }
        break;
    }
  }

  // BUG-FIX #3: draw recibe game para acceso a timers (GravityZone lo necesita)
  draw(ctx, game) { this.onDraw(ctx, game); }

  onTrigger(game)        {}
  onUpdate(dt, game)     { return true; }
  onReset(game)          {}
  onDraw(ctx, game)      {}

  // Sensor: circular { col, row, radius } o rectangular { col, row, w, h }
  _sensorActive(game) {
    const p  = game.state.player;
    // BUG-FIX #4: usar AABB completo del jugador, no sólo su centro
    // Esto es mucho más justo para el jugador — el sensor detecta cualquier
    // solapamiento con la hitbox real, no sólo cuando el centro cruza.
    const tr = this.trigger;
    if (tr.radius !== undefined) {
      const cx = (p.x + PLAYER_W / 2) / CS;
      const cy = (p.y + PLAYER_H / 2) / CS;
      return Math.hypot(cx - (tr.col + 0.5), cy - (tr.row + 0.5)) <= tr.radius;
    }
    const tw = tr.w ?? 1, th = tr.h ?? 1;
    // AABB en espacio de tiles
    const px0 = p.x / CS,              py0 = p.y / CS;
    const px1 = (p.x + PLAYER_W) / CS, py1 = (p.y + PLAYER_H) / CS;
    return px1 > tr.col && px0 < tr.col + tw &&
           py1 > tr.row && py0 < tr.row + th;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ENTIDADES CONCRETAS
// ═══════════════════════════════════════════════════════════════════════════════

// ── SpikeLauncher ─────────────────────────────────────────────────────────────
class SpikeLauncher extends Entity {
  constructor(def) {
    super(def);
    this.speed      = def.speed      ?? 480;
    this.travelDist = def.travelDist ?? CS * 2;
    this._offset    = 0;
    this._savedTile = T_EMPTY;
  }

  onTrigger(game) {
    this._savedTile = game.tileAt(this.col, this.row);
    game.setTile(this.col, this.row, T_SPIKE);
    this._offset = 0;
    sfx('trap');
  }

  onUpdate(dt, game) {
    this._offset = Math.min(this._offset + this.speed * dt, this.travelDist);
    const sy = this.y - this._offset;
    const p  = game.state.player;
    if (_aabb(p.x, p.y, PLAYER_W, PLAYER_H, this.x, sy, CS, CS)) {
      game.killPlayer();
    }
    return this._offset >= this.travelDist;
  }

  onReset(game) {
    game.setTile(this.col, this.row, this._savedTile);
    this._offset = 0;
  }

  onDraw(ctx) {
    if (this.state !== FSM.ANIMATING && this.state !== FSM.TRIGGERED) return;
    const x = this.x, y = this.y - this._offset, s = CS;
    ctx.fillStyle = PAL.spike;
    ctx.beginPath();
    ctx.moveTo(x+s/2, y+2); ctx.lineTo(x+s*0.9, y+s-2); ctx.lineTo(x+s*0.1, y+s-2);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = PAL.spikeG; ctx.lineWidth = 1.5; ctx.stroke();
    // trail
    const trailH = this._offset * 0.4;
    if (trailH > 0) {
      const gr = ctx.createLinearGradient(0, y+s, 0, y+s+trailH);
      gr.addColorStop(0, 'rgba(255,48,64,0.3)'); gr.addColorStop(1, 'rgba(255,48,64,0)');
      ctx.fillStyle = gr; ctx.fillRect(x+4, y+s, s-8, trailH);
    }
  }
}

// ── VanishPlatform ────────────────────────────────────────────────────────────
class VanishPlatform extends Entity {
  constructor(def) {
    super(def);
    this.fadeTime     = def.fadeTime ?? 0.55;
    this.triggerDelay = 0.08;
    this._elapsed     = 0;
    this._blinkTimer  = 0;
    this._visible     = true; // BUG-FIX #5: track visual state separately
  }

  onTrigger(game) {
    this._elapsed    = 0;
    this._blinkTimer = 0;
    this._visible    = true;
    sfx('trap');
  }

  onUpdate(dt, game) {
    this._elapsed    += dt;
    this._blinkTimer += dt;
    const progress = this._elapsed / this.fadeTime;

    if (progress > 0.55) {
      // BUG-FIX #5: blink rate acelerado — usamos Math.floor estable, no dt
      const blinkHz   = 4 + progress * 14;   // 4 Hz → 18 Hz
      const newVis    = Math.floor(this._blinkTimer * blinkHz) % 2 === 0;
      if (newVis !== this._visible) {
        this._visible = newVis;
        game.setTile(this.col, this.row, newVis ? T_SOLID : T_EMPTY);
      }
    }

    if (this._elapsed >= this.fadeTime) {
      game.setTile(this.col, this.row, T_EMPTY);
      this._visible = false;
      return true;
    }
    return false;
  }

  onReset(game) {
    game.setTile(this.col, this.row, T_SOLID);
    this._elapsed = 0;
    this._visible = true;
  }

  onDraw(ctx) {
    if (this.state !== FSM.ANIMATING) return;
    const alpha = Math.max(0, 1 - this._elapsed / this.fadeTime);
    ctx.save();
    ctx.globalAlpha = alpha * 0.6;
    ctx.fillStyle   = '#ff8040';
    ctx.fillRect(this.x, this.y, CS, CS);
    ctx.restore();
  }
}

// ── DropBlock ─────────────────────────────────────────────────────────────────
class DropBlock extends Entity {
  constructor(def) {
    super(def);
    this._initSpeed = def.speed ?? 80;
    this._speed     = this._initSpeed;
    this._fy        = this.row * CS;
    this._accel     = 1440;
    this._maxSpd    = 840;
  }

  onTrigger(game) {
    // BUG-FIX #6: DropBlock usaba this.speed (undefined) en onTrigger
    this._fy    = this.row * CS;
    this._speed = this._initSpeed;
    sfx('trap');
  }

  onUpdate(dt, game) {
    this._speed = Math.min(this._speed + this._accel * dt, this._maxSpd);
    this._fy   += this._speed * dt;
    const row   = Math.floor(this._fy / CS);

    // Crush AABB — más preciso que comparación por columna
    const p = game.state.player;
    if (_aabb(p.x, p.y, PLAYER_W, PLAYER_H, this.col*CS, this._fy, CS, CS)) {
      game.killPlayer();
    }

    if (row >= game.state.lvl.ph - 1 || game.isSolid(game.tileAt(this.col, row+1))) {
      game.setTile(this.col, row, T_SOLID);
      return true;
    }
    return false;
  }

  onDraw(ctx) {
    if (this.state !== FSM.ANIMATING && this.state !== FSM.TRIGGERED) return;
    const x = this.col*CS, y = this._fy, s = CS;
    const gr = ctx.createLinearGradient(x, y, x, y+s);
    gr.addColorStop(0, '#e04020'); gr.addColorStop(1, '#802010');
    ctx.fillStyle = gr; ctx.fillRect(x+1, y+1, s-2, s-2);
    ctx.strokeStyle = '#ff8060'; ctx.lineWidth = 1;
    ctx.strokeRect(x+1, y+1, s-2, s-2);
  }
}

// ── GravityZone ───────────────────────────────────────────────────────────────
class GravityZone extends Entity {
  constructor(def) {
    super(def);
    this.duration = def.duration ?? GRAV_DUR;
  }

  onTrigger(game) {
    game.state.gravFlip  = true;
    game.state.gravTimer = this.duration;
    game._showMsg('GRAVITY INVERTED');
    sfx('trap');
  }

  onUpdate(dt, game) { return true; }

  // BUG-FIX #7: GravityZone.onDraw recibe game como 2nd arg pero la firma
  // original sólo aceptaba ctx → pulso invisible silencioso.
  onDraw(ctx, game) {
    if (this.state !== FSM.IDLE || !this.trigger) return;
    const tr    = this.trigger;
    const pulse = Math.sin(Date.now() * 0.004) * 0.5 + 0.5;
    ctx.strokeStyle = `rgba(255,0,170,${pulse * 0.22})`;
    ctx.lineWidth   = 1;
    ctx.setLineDash([3, 4]);
    if (tr.radius !== undefined) {
      ctx.beginPath();
      ctx.arc((tr.col+0.5)*CS, (tr.row+0.5)*CS, tr.radius*CS, 0, Math.PI*2);
      ctx.stroke();
    } else {
      ctx.strokeRect(tr.col*CS, tr.row*CS, (tr.w??1)*CS, (tr.h??1)*CS);
    }
    ctx.setLineDash([]);
  }
}

// ── FakeExit ──────────────────────────────────────────────────────────────────
class FakeExit extends Entity {
  constructor(def) {
    super(def);
    this.triggerDelay = 0;
    this.resetDelay   = def.resetDelay ?? 1.5;
    this.oneShot      = def.oneShot    ?? false;
  }

  onTrigger(game) {
    game.setTile(this.col, this.row, T_SPIKE);
    game._showMsg('NICE TRY — NOT THE EXIT');
    sfx('troll');
  }

  onUpdate(dt, game) { return true; }

  onReset(game) { game.setTile(this.col, this.row, T_EXIT); }
}

// ── REGISTRO & FACTORY ────────────────────────────────────────────────────────
const ENTITY_TYPES = {
  spike_launcher:  SpikeLauncher,
  vanish_platform: VanishPlatform,
  drop_block:      DropBlock,
  gravity_zone:    GravityZone,
  fake_exit:       FakeExit,
};

function createEntity(def) {
  const Cls = ENTITY_TYPES[def.type];
  if (!Cls) { console.warn(`[FSM] Tipo desconocido: "${def.type}"`); return null; }
  return new Cls(def);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GAME CLASS
// ═══════════════════════════════════════════════════════════════════════════════
class Game {
  constructor() {
    this.canvas = document.getElementById('c');
    this.ctx    = this.canvas.getContext('2d');
    this.levels = [];
    this.SCALE  = 1;

    this.state = {
      lvlIdx: 0, deaths: 0,
      hi: +(localStorage.getItem('ft_hi') || 0),
      player: null, map: null, lvl: null,
      triggers: [], firedTriggers: new Set(),
      ghostTiles: new Map(), spikeReveal: new Set(),
      fallingBlocks: [],
      gravFlip: false, gravTimer: 0,
      running: false, paused: false,
      dying: false, deathTimer: 0,
      flashTimer: 0, invinTimer: 0,
      entities: [],
      // BUG-FIX #8: flag para bloquear handleExit múltiples en el mismo frame
      exitHandled: false,
    };

    this.keys = { left:false, right:false, jump:false, jumpJustPressed:false };
    this._jumpWasDown  = false;
    this._lastTS       = 0;
    this._physAccum    = 0;
    this._accumFPS     = 0;
    this._fpsCount     = 0;
    this.currentFPS    = 60;

    // BUG-FIX #9: coyote & jump-buffer timers — vivían sólo en el jugador pero
    // se necesitan antes de crearlo. Se inicializan aquí y se resetean en respawn.
    this._coyoteTimer  = 0;  // tiempo desde que dejó el suelo sin saltar
    this._jumpBufTimer = 0;  // tiempo desde que el jugador pulsó salto en el aire

    this._bindInput();
    this._bindButtons();
    this._bindUI();
  }

  // ── Cargador asíncrono — cache-bust garantizado en GitHub Pages ───────────
  async init() {
    try {
      const res = await fetch('./mapa.json?v=' + Date.now());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.levels = await res.json();
    } catch(e) {
      console.error('[FLUXTRAP] Error cargando mapa.json:', e);
    }
    this.resizeCanvas();
    requestAnimationFrame(ts => this._loop(ts));
  }

  start() {
    initAudio();
    this._hideOverlay();
    this.loadLevel(0);
    this.state.running = true;
    this.state.paused  = false;
    this._lastTS    = performance.now();
    this._physAccum = 0;
  }

  // ── NIVEL ─────────────────────────────────────────────────────────────────
  loadLevel(idx) {
    const s   = this.state;
    const lvl = this.levels[idx];
    if (!lvl) return;

    s.lvlIdx        = idx;
    s.lvl           = lvl;
    s.map           = [...lvl.map];
    s.triggers      = lvl.triggers ? lvl.triggers.map(t => ({...t})) : [];
    s.firedTriggers = new Set();
    s.ghostTiles    = new Map();
    s.spikeReveal   = new Set();
    s.fallingBlocks = [];
    s.gravFlip      = false;  s.gravTimer  = 0;
    s.dying         = false;  s.deathTimer = 0;
    s.invinTimer    = 0;
    s.exitHandled   = false;

    s.entities = [];
    if (lvl.entities) {
      for (const def of lvl.entities) {
        const ent = createEntity(def);
        if (ent) s.entities.push(ent);
      }
    }

    s.player = {
      x: lvl.sx * CS + CS/2 - PLAYER_W/2,
      y: lvl.sy * CS - PLAYER_H,
      vx: 0, vy: 0, onGround: false,
      eyeAng: 0, stretch: 1, lean: 0, blinking: 0, trailPts: [],
    };

    this._coyoteTimer  = 0;
    this._jumpBufTimer = 0;

    this.resizeCanvas();
    document.getElementById('hv-lvl').textContent = String(idx+1).padStart(2,'0');
  }

  resizeCanvas() {
    const arena = document.getElementById('arena');
    const aw = arena.clientWidth, ah = arena.clientHeight;
    const lvl = this.levels[this.state.lvlIdx];
    if (!lvl) return;
    const gw = lvl.pw * CS, gh = lvl.ph * CS;
    this.SCALE = Math.min(aw/gw, ah/gh, 2);
    this.canvas.width  = gw;
    this.canvas.height = gh;
    this.canvas.style.width  = Math.floor(gw * this.SCALE) + 'px';
    this.canvas.style.height = Math.floor(gh * this.SCALE) + 'px';
  }

  // ── TILES ─────────────────────────────────────────────────────────────────
  tileAt(col, row) {
    const lvl = this.state.lvl;
    if (!lvl || col < 0 || row < 0 || col >= lvl.pw || row >= lvl.ph) return T_SOLID;
    return this.state.map[row * lvl.pw + col];
  }

  setTile(col, row, val) {
    const lvl = this.state.lvl;
    if (!lvl || col < 0 || row < 0 || col >= lvl.pw || row >= lvl.ph) return;
    this.state.map[row * lvl.pw + col] = val;
  }

  isSolid(t) { return t === T_SOLID || t === T_FAKE || t === T_GHOST; }

  // ── AABB sweep — resolución de colisiones por eje ─────────────────────────
  //
  //  BUG-FIX #10: el sweep original chequeaba sólo UNA fila/columna de destino.
  //  Con dt variable (pasos fraccionarios) o velocidad alta el jugador podía
  //  atravesar una pared delgada (1 tile).
  //  Solución: iterar cada tile entre origen y destino en el eje de movimiento.
  //
  _sweepX(x, y, dx) {
    if (dx === 0) return { nx: x, hitWall: false };
    const sign = Math.sign(dx);
    let   nx   = x + dx;
    const r0   = Math.floor(y / CS), r1 = Math.floor((y + PLAYER_H - 1) / CS);
    // columna de entrada en el eje de movimiento
    const colStart = dx > 0
      ? Math.floor((x + PLAYER_W) / CS)
      : Math.floor(x / CS) - 1;
    const colEnd   = dx > 0
      ? Math.floor((nx + PLAYER_W - 1) / CS)
      : Math.floor(nx / CS);

    for (let col = colStart; sign > 0 ? col <= colEnd : col >= colEnd; col += sign) {
      for (let r = r0; r <= r1; r++) {
        const t = this.tileAt(col, r);
        this._handleSpecialTile(t, col, r);
        if (!this.isSolid(t)) continue;
        nx = dx > 0 ? col*CS - PLAYER_W : (col+1)*CS;
        return { nx, hitWall: true };
      }
    }
    return { nx, hitWall: false };
  }

  _sweepY(x, y, dy) {
    if (dy === 0) return { ny: y, hitFloor: false, hitCeiling: false };
    const sign = Math.sign(dy);
    let   ny   = y + dy;
    const c0   = Math.floor(x / CS), c1 = Math.floor((x + PLAYER_W - 1) / CS);
    const rowStart = dy > 0
      ? Math.floor((y + PLAYER_H) / CS)
      : Math.floor(y / CS) - 1;
    const rowEnd   = dy > 0
      ? Math.floor((ny + PLAYER_H - 1) / CS)
      : Math.floor(ny / CS);

    for (let row = rowStart; sign > 0 ? row <= rowEnd : row >= rowEnd; row += sign) {
      for (let c = c0; c <= c1; c++) {
        const t = this.tileAt(c, row);
        this._handleSpecialTile(t, c, row);
        if (!this.isSolid(t)) continue;
        ny = dy > 0 ? row*CS - PLAYER_H : (row+1)*CS;
        return { ny, hitFloor: dy > 0, hitCeiling: dy < 0 };
      }
    }
    return { ny, hitFloor: false, hitCeiling: false };
  }

  // Tiles que reaccionan al contacto sin ser sólidos
  _handleSpecialTile(t, c, r) {
    const gk = `${c},${r}`;
    if (t === T_HSPIKE && !this.state.spikeReveal.has(gk)) {
      this.state.spikeReveal.add(gk);
      this.setTile(c, r, T_SPIKE);
      sfx('trap');
    }
    if (t === T_GRAV && !this.state.firedTriggers.has(gk)) {
      this.state.firedTriggers.add(gk);
      this.state.gravFlip  = true;
      this.state.gravTimer = GRAV_DUR;
      this._showMsg('GRAVITY INVERTED');
      sfx('trap');
    }
  }

  // Ghost (6) y fake (5) — se evalúan estando encima del tile
  _checkSpecialUnderfoot(x, y, vy) {
    const row = Math.floor((y + PLAYER_H) / CS);
    const c0  = Math.floor(x / CS), c1 = Math.floor((x + PLAYER_W - 1) / CS);
    for (let c = c0; c <= c1; c++) {
      const tileRow = row - 1;
      if (tileRow < 0) continue;
      const t  = this.tileAt(c, tileRow);
      const gk = `${c},${tileRow}`;
      if (t === T_GHOST) {
        const cnt = (this.state.ghostTiles.get(gk) || 0) + 1;
        this.state.ghostTiles.set(gk, cnt);
        if (cnt > 4) { this.setTile(c, tileRow, T_EMPTY); this.state.ghostTiles.delete(gk); sfx('trap'); }
      }
      if (t === T_FAKE && vy > 0 && !this.state.firedTriggers.has('f5'+gk)) {
        this.state.firedTriggers.add('f5'+gk);
        // BUG-FIX #11: setTimeout no usa deltaTime — mover a un timer físico
        // para que la plataforma no desaparezca a mitad de pausa
        this._fakePlatformTimers = this._fakePlatformTimers || [];
        this._fakePlatformTimers.push({ c, row: tileRow, t: 0.3 });
        sfx('trap');
      }
    }
  }

  touchesSpike(x, y) {
    const c0 = Math.floor(x / CS), c1 = Math.floor((x + PLAYER_W - 1) / CS);
    const r0 = Math.floor(y / CS), r1 = Math.floor((y + PLAYER_H - 1) / CS);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const t = this.tileAt(c, r);
      if (t === T_SPIKE || t === T_HSPIKE) return true;
    }
    return false;
  }

  // ── Timers de plataforma fake (sustituye setTimeout) ──────────────────────
  _tickFakePlatformTimers(dt) {
    if (!this._fakePlatformTimers) return;
    for (let i = this._fakePlatformTimers.length - 1; i >= 0; i--) {
      const fp = this._fakePlatformTimers[i];
      fp.t -= dt;
      if (fp.t <= 0) {
        this.setTile(fp.c, fp.row, T_EMPTY);
        this._fakePlatformTimers.splice(i, 1);
      }
    }
  }

  // ── Triggers legacy (compatibilidad hacia atrás) ───────────────────────────
  checkTriggers() {
    const p  = this.state.player;
    const pc = (p.x + PLAYER_W/2) / CS, pr = (p.y + PLAYER_H/2) / CS;
    for (const tr of this.state.triggers) {
      if (this.state.firedTriggers.has(tr.id)) continue;
      if (Math.hypot(pc - tr.cx, pr - tr.cy) < tr.r) {
        this.state.firedTriggers.add(tr.id);
        this._execLegacyTrigger(tr);
      }
    }
  }

  _execLegacyTrigger(tr) {
    sfx('trap');
    if (tr.action === 'drop_block')
      this.state.fallingBlocks.push({ c: tr.blockCol, fy: 0, speed: 80, landed: false });
    else if (tr.action === 'spike_wall')
      for (const c of tr.cols) this.setTile(c, tr.row, T_SPIKE);
    else if (tr.action === 'reveal_spikes')
      for (let r = 0; r < this.state.lvl.ph; r++)
        for (let c = 0; c < this.state.lvl.pw; c++)
          if (this.tileAt(c,r) === T_HSPIKE) this.setTile(c,r,T_SPIKE);
    else if (tr.action === 'gravity_flip') {
      this.state.gravFlip = true; this.state.gravTimer = GRAV_DUR;
      this._showMsg('GRAVITY INVERTED');
    }
  }

  // BUG-FIX #12: fallingBlocks legacy también usa AABB en vez de column-only
  _updateFallingBlocks(dt) {
    const ACC = 1440, MAX = 840;
    for (let i = this.state.fallingBlocks.length - 1; i >= 0; i--) {
      const fb = this.state.fallingBlocks[i];
      if (fb.landed) continue;
      fb.speed = Math.min(fb.speed + ACC * dt, MAX);
      fb.fy   += fb.speed * dt;
      const row = Math.floor(fb.fy / CS);
      if (row >= this.state.lvl.ph-1 || this.isSolid(this.tileAt(fb.c, row+1))) {
        this.setTile(fb.c, row, T_SOLID);
        this.state.fallingBlocks.splice(i, 1);
        const p = this.state.player;
        if (_aabb(p.x, p.y, PLAYER_W, PLAYER_H, fb.c*CS, fb.fy, CS, CS))
          this.killPlayer();
      }
    }
  }

  // ── Pool FSM ──────────────────────────────────────────────────────────────
  _updateEntities(dt) {
    const ents = this.state.entities;
    for (let i = ents.length - 1; i >= 0; i--) {
      ents[i].update(dt, this);
      if (ents[i]._dead) ents.splice(i, 1);
    }
  }

  // ── JUGADOR ───────────────────────────────────────────────────────────────
  killPlayer() {
    const s = this.state;
    if (s.dying || s.invinTimer > 0) return;
    s.dying = true; s.deathTimer = DEATH_DUR;
    s.deaths++;
    s.flashTimer = FLASH_DUR;
    sfx('die');
    this._showMsg(_rnd(TAUNTS));
    document.getElementById('hv-deaths').textContent = s.deaths;
    const arena = document.getElementById('arena');
    arena.style.animation = 'none';
    // BUG-FIX #13: forzar reflow para reiniciar la animación CSS correctamente
    void arena.offsetWidth;
    arena.style.animation = 'shake .25s';
  }

  respawn() {
    const lvl = this.state.lvl, p = this.state.player;
    p.x = lvl.sx * CS + CS/2 - PLAYER_W/2;
    p.y = lvl.sy * CS - PLAYER_H;
    p.vx = 0; p.vy = 0; p.onGround = false; p.trailPts = [];
    this.state.dying      = false;
    this.state.invinTimer = INVIN_DUR;
    this.state.gravFlip   = false;
    this.state.gravTimer  = 0;
    this.state.exitHandled = false;
    this._coyoteTimer     = 0;
    this._jumpBufTimer    = 0;
    // BUG-FIX #14: limpiar timers de plataforma pendientes al respawnear
    this._fakePlatformTimers = [];
  }

  // BUG-FIX #15: handleExit podía dispararse varias veces en el mismo frame
  // (el jugador ocupa 2 tiles y ambos eran EXIT) → doble overlay / doble progreso
  handleExit(ec, er) {
    if (this.state.exitHandled) return;
    this.state.exitHandled = true;

    if (Math.random() < 0.5) {
      this.setTile(ec, er, T_SPIKE);
      sfx('troll');
      this._showMsg('NICE TRY - NOT THE EXIT');
      // BUG-FIX #16: usar timer físico en vez de setTimeout para que respete pausa
      this._exitRestoreTimer = { c: ec, r: er, t: 1.5 };
      return;
    }
    sfx('win');
    if (this.state.lvlIdx < this.levels.length - 1) {
      this._showOverlay('ZONE CLEARED', `ZONE ${this.state.lvlIdx+1} COMPLETE`,
        `Deaths: ${this.state.deaths}`, 'NEXT ZONE', () => {
          this.loadLevel(this.state.lvlIdx + 1); this._hideOverlay();
        });
    } else {
      localStorage.setItem('ft_hi', this.state.deaths);
      this._showOverlay('YOU SURVIVED', `Total deaths: ${this.state.deaths}`,
        'ALL ZONES CLEARED', 'PLAY AGAIN', () => {
          this.state.deaths = 0;
          document.getElementById('hv-deaths').textContent = '0';
          this.loadLevel(0); this._hideOverlay();
        });
    }
  }

  // ── GAME LOOP (Fixed-Timestep Accumulator) ────────────────────────────────
  _loop(ts) {
    requestAnimationFrame(t => this._loop(t));
    const s = this.state;
    if (!s.running || s.paused) return;

    if (this._lastTS === 0) this._lastTS = ts;
    const rawDt = Math.min((ts - this._lastTS) * 0.001, MAX_DT);
    this._lastTS = ts;

    this._accumFPS += rawDt; this._fpsCount++;
    if (this._accumFPS >= 1) {
      this.currentFPS = this._fpsCount; this._fpsCount = 0; this._accumFPS -= 1;
    }

    this._physAccum += rawDt;
    let steps = 0;
    while (this._physAccum >= TARGET_DT && steps < 5) {
      this._physicsStep(TARGET_DT); this._physAccum -= TARGET_DT; steps++;
    }
    if (this._physAccum > 0 && steps < 5) {
      this._physicsStep(this._physAccum); this._physAccum = 0;
    }

    this.render();
  }

  _physicsStep(dt) {
    const s = this.state;

    // — Timers globales —
    if (s.flashTimer  > 0) s.flashTimer  = Math.max(0, s.flashTimer  - dt);
    if (s.invinTimer  > 0) s.invinTimer  = Math.max(0, s.invinTimer  - dt);
    if (s.gravTimer   > 0) {
      s.gravTimer = Math.max(0, s.gravTimer - dt);
      if (s.gravTimer === 0) { s.gravFlip = false; this._showMsg('GRAVITY RESTORED'); }
    }

    // — Exit restore timer (reemplaza setTimeout) —
    if (this._exitRestoreTimer) {
      this._exitRestoreTimer.t -= dt;
      if (this._exitRestoreTimer.t <= 0) {
        this.setTile(this._exitRestoreTimer.c, this._exitRestoreTimer.r, T_EXIT);
        this._exitRestoreTimer = null;
        // Permite volver a interactuar con la salida tras el troll
        s.exitHandled = false;
      }
    }

    // — Entidades FSM (corren siempre, incluso durante la muerte) —
    this._updateEntities(dt);
    this._tickFakePlatformTimers(dt);

    if (s.dying) {
      s.deathTimer = Math.max(0, s.deathTimer - dt);
      if (s.deathTimer === 0) this.respawn();
      return;
    }

    const p    = s.player;
    const gDir = s.gravFlip ? -1 : 1;

    // — Gravedad —
    p.vy += GRAVITY * gDir * dt;
    if (Math.abs(p.vy) > MAX_FALL) p.vy = MAX_FALL * Math.sign(p.vy);

    // — Movimiento horizontal —
    if (this.keys.left)  p.vx -= MOVE_ACC * dt;
    if (this.keys.right) p.vx += MOVE_ACC * dt;
    // Fricción diferenciada: en suelo frena casi al instante, en el aire conserva impulso
    const fric = p.onGround ? FRIC_GND : FRIC_AIR;
    p.vx *= Math.pow(fric, dt);
    // Umbral de parada: evita micro-deslizamientos cuando se suelta la tecla en suelo
    if (p.onGround && !this.keys.left && !this.keys.right && Math.abs(p.vx) < 2) p.vx = 0;
    if (Math.abs(p.vx) > MOVE_SPD) p.vx = MOVE_SPD * Math.sign(p.vx);

    // — Coyote time: mantener ventana de salto tras caer de borde —
    const wasGround = p.onGround;
    if (wasGround) {
      this._coyoteTimer = COYOTE_TIME;
    } else {
      this._coyoteTimer = Math.max(0, this._coyoteTimer - dt);
    }

    // — Jump buffer: registrar salto hasta 100 ms antes de tocar suelo —
    if (this.keys.jumpJustPressed) {
      this._jumpBufTimer = JUMP_BUFFER;
    } else {
      this._jumpBufTimer = Math.max(0, this._jumpBufTimer - dt);
    }
    this.keys.jumpJustPressed = false;

    // — Salto: coyote OR en suelo, combinado con jump buffer —
    const canJump = this._coyoteTimer > 0 || s.gravFlip;
    if (this._jumpBufTimer > 0 && canJump) {
      p.vy = JUMP_VEL * (s.gravFlip ? -1 : 1);
      p.onGround        = false;
      this._coyoteTimer = 0;   // consumir la ventana coyote
      this._jumpBufTimer= 0;   // consumir el buffer
      sfx('jump');
    }

    // — Trail —
    p.trailPts.push({ x: p.x, y: p.y });
    if (p.trailPts.length > 6) p.trailPts.shift();

    // — AABB: eje X → eje Y —
    p.onGround = false;
    const dx = p.vx * dt, dy = p.vy * dt;

    const rx = this._sweepX(p.x, p.y, dx);
    if (rx.hitWall) p.vx = 0;
    p.x = rx.nx;

    const ry = this._sweepY(p.x, p.y, dy);
    if (ry.hitFloor)   { p.onGround = true; p.vy = 0; }
    if (ry.hitCeiling) { p.vy = 0; }
    p.y = ry.ny;

    // Squash visual al aterrizar — sin sonido (evita vibración en suelo)
    if (!wasGround && p.onGround && dy > 0.5) {
      p.stretch = 1 + Math.min(dy * 0.06, 0.35);
    }

    this._checkSpecialUnderfoot(p.x, p.y, p.vy);

    // — Cosmética —
    p.stretch += (1 - p.stretch) * Math.min(dt * 15, 1);
    p.lean    += (p.vx - p.lean) * Math.min(dt * 12, 1);
    if (Math.random() < dt * 0.18) p.blinking = 0.133;
    if (p.blinking > 0) p.blinking = Math.max(0, p.blinking - dt);
    p.eyeAng  += (Math.atan2(p.vy * 0.3, p.vx) - p.eyeAng) * Math.min(dt * 9, 1);

    // — Muerte por spike o caída fuera del mapa —
    if (this.touchesSpike(p.x, p.y)) this.killPlayer();
    if (p.y > this.canvas.height + CS || p.y < -CS * 2) this.killPlayer();

    // — Triggers legacy —
    this.checkTriggers();
    this._updateFallingBlocks(dt);

    // — Salida —
    // BUG-FIX #17: no comprobar salida si ya está muriendo (evita win en muerte)
    if (!s.dying) {
      const c0 = Math.floor(p.x / CS), c1 = Math.floor((p.x + PLAYER_W - 1) / CS);
      const r0 = Math.floor(p.y / CS), r1 = Math.floor((p.y + PLAYER_H - 1) / CS);
      outer:
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        if (this.tileAt(c,r) === T_EXIT) { this.handleExit(c,r); break outer; }
      }
    }
  }

  // ── RENDERER ──────────────────────────────────────────────────────────────
  render() {
    const s = this.state;
    if (!s.lvl) return;

    this._drawBackground();
    this._drawGravFlipFX();

    for (let r = 0; r < s.lvl.ph; r++) for (let c = 0; c < s.lvl.pw; c++) {
      const t = this.tileAt(c, r);
      if (t !== T_EMPTY) this._drawTile(c, r, t);
    }

    this._drawFallingBlocks();

    // Entidades FSM — sobre tiles, bajo el jugador
    for (const ent of s.entities) ent.draw(this.ctx, this);

    this._drawPlayer();
    this._drawDeathAnim();
    this._drawFlash();
  }

  _drawBackground() {
    const ctx = this.ctx;
    ctx.fillStyle = PAL.bg; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.strokeStyle = 'rgba(20,40,60,.4)'; ctx.lineWidth = .5;
    for (let x = 0; x < this.canvas.width; x += CS) {
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x, this.canvas.height); ctx.stroke();
    }
    for (let y = 0; y < this.canvas.height; y += CS) {
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(this.canvas.width, y); ctx.stroke();
    }
  }

  _drawGravFlipFX() {
    if (!this.state.gravFlip) return;
    this.ctx.fillStyle = `rgba(255,0,170,${.04 + Math.sin(Date.now()*.01)*.02})`;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  _drawFlash() {
    if (this.state.flashTimer > 0) {
      this.ctx.fillStyle = `rgba(255,50,64,${(this.state.flashTimer/FLASH_DUR)*0.45})`;
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  _drawTile(col, row, t) {
    const ctx = this.ctx, x = col*CS, y = row*CS, s = CS;
    if (t === T_SOLID) {
      const g = ctx.createLinearGradient(x,y,x,y+s);
      g.addColorStop(0, PAL.floor); g.addColorStop(1, PAL.steel);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.roundRect(x+1,y+1,s-2,s-2,2); ctx.fill();
      ctx.strokeStyle = PAL.floorG; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x+2,y+2); ctx.lineTo(x+s-2,y+2); ctx.stroke();
    } else if (t === T_SPIKE || t === T_HSPIKE) {
      ctx.fillStyle = PAL.spike;
      const mid = x+s/2, tip = y+2, base = y+s-2, hw = s*0.4;
      ctx.beginPath(); ctx.moveTo(mid,tip); ctx.lineTo(mid+hw,base); ctx.lineTo(mid-hw,base);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = PAL.spikeG; ctx.lineWidth = 1.5; ctx.stroke();
    } else if (t === T_FAKE) {
      ctx.fillStyle = PAL.fake;
      ctx.beginPath(); ctx.roundRect(x+2,y+2,s-4,s-4,3); ctx.fill();
      ctx.strokeStyle = 'rgba(160,120,255,.6)'; ctx.lineWidth = 1;
      ctx.setLineDash([3,3]); ctx.strokeRect(x+2,y+2,s-4,s-4); ctx.setLineDash([]);
    } else if (t === T_GHOST) {
      ctx.fillStyle = PAL.ghost; ctx.fillRect(x+1,y+1,s-2,s-2);
      ctx.strokeStyle = 'rgba(40,255,150,.5)'; ctx.lineWidth = 1;
      ctx.setLineDash([2,2]); ctx.strokeRect(x+1,y+1,s-2,s-2); ctx.setLineDash([]);
    } else if (t === T_GRAV) {
      ctx.fillStyle = '#100820'; ctx.fillRect(x+1,y+1,s-2,s-2);
      ctx.fillStyle = 'rgba(255,0,170,.25)'; ctx.fillRect(x+1,y+1,s-2,s-2);
      ctx.strokeStyle = PAL.grav; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x+s/2,y+4); ctx.lineTo(x+s/2-4,y+9); ctx.lineTo(x+s/2+4,y+9);
      ctx.closePath(); ctx.fill();
      ctx.moveTo(x+s/2,y+s-4); ctx.lineTo(x+s/2-4,y+s-9); ctx.lineTo(x+s/2+4,y+s-9);
      ctx.closePath(); ctx.fill();
    } else if (t === T_EXIT) {
      const pulse = Math.sin(Date.now()*0.005)*0.4+0.6;
      ctx.fillStyle = `rgba(0,255,200,${pulse*0.18})`; ctx.fillRect(x,y,s,s);
      ctx.strokeStyle = `rgba(0,255,200,${pulse})`; ctx.lineWidth = 2;
      ctx.strokeRect(x+2,y+2,s-4,s-4);
      ctx.fillStyle = `rgba(0,255,200,${pulse})`;
      ctx.font = `bold ${s*0.5}px monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('E', x+s/2, y+s/2);
    }
  }

  _drawFallingBlocks() {
    const ctx = this.ctx;
    for (const fb of this.state.fallingBlocks) {
      const x=fb.c*CS, y=fb.fy, s=CS;
      const g=ctx.createLinearGradient(x,y,x,y+s);
      g.addColorStop(0,'#e04020'); g.addColorStop(1,'#802010');
      ctx.fillStyle=g; ctx.fillRect(x+1,y+1,s-2,s-2);
      ctx.strokeStyle='#ff8060'; ctx.lineWidth=1; ctx.strokeRect(x+1,y+1,s-2,s-2);
    }
  }

  _drawPlayer() {
    if (this.state.dying) return;
    const p   = this.state.player, ctx = this.ctx;
    // BUG-FIX: Math.floor en lugar de Math.round evita sub-pixel jitter visible
    const inv = this.state.invinTimer > 0 && Math.floor(this.state.invinTimer * 15) % 2 === 0;
    const px  = Math.floor(p.x), py = Math.floor(p.y), w = PLAYER_W, h = PLAYER_H;

    for (let i = 0; i < p.trailPts.length; i++) {
      const tp = p.trailPts[i];
      ctx.fillStyle = `rgba(0,255,200,${(i/p.trailPts.length)*0.25})`;
      ctx.fillRect(Math.floor(tp.x)+3, Math.floor(tp.y)+3, w-6, h-6);
    }

    ctx.save();
    ctx.translate(px + w/2, py + h/2);
    if (p.lean) ctx.rotate((p.lean / MOVE_SPD) * 0.08);
    ctx.scale(1/p.stretch, p.stretch);
    const hw=w/2, hh=h/2;
    ctx.fillStyle = inv ? 'rgba(200,240,255,.5)' : PAL.player;
    ctx.beginPath(); ctx.roundRect(-hw,-hh,w,h,4); ctx.fill();
    ctx.strokeStyle = this.state.gravFlip ? PAL.grav : PAL.eye;
    ctx.lineWidth = 1.5; ctx.stroke();
    const ex=Math.cos(p.eyeAng)*3, ey=Math.sin(p.eyeAng)*2, eR=w*0.28;
    ctx.fillStyle = PAL.eye;
    ctx.beginPath(); ctx.arc(ex,ey,eR,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = PAL.pupil;
    ctx.beginPath(); ctx.arc(ex+Math.cos(p.eyeAng)*eR*.4, ey+Math.sin(p.eyeAng)*eR*.4, eR*.45, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,.6)';
    ctx.beginPath(); ctx.arc(ex-eR*.3,ey-eR*.3,eR*.22,0,Math.PI*2); ctx.fill();
    if (p.blinking > 0) { ctx.fillStyle=PAL.player; ctx.fillRect(-hw,-hh,w,h/2); }
    ctx.restore();
    if (this.state.gravFlip) {
      ctx.strokeStyle='rgba(255,0,170,.5)'; ctx.lineWidth=1;
      ctx.setLineDash([2,2]); ctx.strokeRect(px-2,py-2,w+4,h+4); ctx.setLineDash([]);
    }
  }

  _drawDeathAnim() {
    if (!this.state.dying) return;
    const ctx=this.ctx, p=this.state.player;
    const t = 1 - (this.state.deathTimer / DEATH_DUR);
    for (let i=0; i<8; i++) {
      const ang=( i/8)*Math.PI*2+t*4, dist=t*CS*1.8;
      const cx=p.x+PLAYER_W/2+Math.cos(ang)*dist;
      const cy=p.y+PLAYER_H/2+Math.sin(ang)*dist;
      const sz=(1-t)*8;
      ctx.fillStyle=`rgba(255,50,64,${1-t})`;
      ctx.fillRect(cx-sz/2,cy-sz/2,sz,sz);
    }
    ctx.save(); ctx.globalAlpha=1-t; ctx.fillStyle=PAL.eye;
    ctx.beginPath(); ctx.arc(p.x+PLAYER_W/2, p.y+PLAYER_H/2-t*30, 6*(1-t*.8), 0, Math.PI*2);
    ctx.fill(); ctx.restore();
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  _showMsg(txt) {
    const el = document.getElementById('h-msg');
    el.textContent = txt; el.classList.add('show');
    clearTimeout(this._msgTimer);
    this._msgTimer = setTimeout(() => el.classList.remove('show'), MSG_DUR*1000);
  }

  _showOverlay(pre, title, sub, btnTxt, btnCb) {
    document.getElementById('ov-pre').textContent   = pre;
    document.getElementById('ov-title').textContent = title;
    document.getElementById('ov-sub').textContent   = sub;
    document.getElementById('ov-tip').style.display = 'none';
    const btn = document.getElementById('ov-btn');
    btn.textContent = btnTxt; btn.onclick = btnCb;
    document.getElementById('overlay').classList.remove('off');
  }

  _hideOverlay() { document.getElementById('overlay').classList.add('off'); }

  _togglePause() {
    if (!this.state.running) return;
    this.state.paused = !this.state.paused;
    if (this.state.paused) {
      this._showOverlay('PAUSED','','','RESUME', () => {
        this.state.paused = false;
        this._lastTS = performance.now(); this._physAccum = 0;
        this._hideOverlay();
      });
    }
  }

  // ── INPUT ─────────────────────────────────────────────────────────────────
  _bindInput() {
    document.addEventListener('keydown', e => {
      if (e.key==='p'||e.key==='P'||e.key==='Escape') { this._togglePause(); return; }
      if (e.key==='ArrowLeft' ||e.key==='a'||e.key==='A') this.keys.left  = true;
      if (e.key==='ArrowRight'||e.key==='d'||e.key==='D') this.keys.right = true;
      if ((e.key===' '||e.key==='ArrowUp'||e.key==='w'||e.key==='W') && !this._jumpWasDown) {
        this.keys.jump = true;
        this.keys.jumpJustPressed = true;
        this._jumpWasDown = true;
      }
      e.preventDefault();
    }, { passive:false });

    document.addEventListener('keyup', e => {
      if (e.key==='ArrowLeft' ||e.key==='a'||e.key==='A') this.keys.left  = false;
      if (e.key==='ArrowRight'||e.key==='d'||e.key==='D') this.keys.right = false;
      if (e.key===' '||e.key==='ArrowUp'||e.key==='w'||e.key==='W') {
        this.keys.jump = false; this._jumpWasDown = false;
      }
    });
  }

  _bindButtons() {
    this._bindBtn('btn-l','left'); this._bindBtn('btn-r','right'); this._bindBtn('btn-jump','jump');
  }

  _bindBtn(id, keyName) {
    const el = document.getElementById(id); if (!el) return;
    const down = e => {
      e.preventDefault(); this.keys[keyName] = true;
      if (keyName==='jump' && !this._jumpWasDown) {
        this.keys.jumpJustPressed = true; this._jumpWasDown = true;
      }
      el.classList.add('pressed');
    };
    const up = e => {
      e.preventDefault(); this.keys[keyName] = false;
      if (keyName==='jump') this._jumpWasDown = false;
      el.classList.remove('pressed');
    };
    el.addEventListener('touchstart', down, { passive:false });
    el.addEventListener('touchend',   up,   { passive:false });
    el.addEventListener('mousedown',  down);
    el.addEventListener('mouseup',    up);
    el.addEventListener('mouseleave', up);
  }

  _bindUI() {
    document.getElementById('btn-pause').addEventListener('click', () => this._togglePause());
    const startOnce = () => { initAudio(); this.start(); };
    document.getElementById('ov-btn').addEventListener('click', startOnce, { once:true });
    document.getElementById('ov-btn').addEventListener('touchstart', e => {
      e.preventDefault(); startOnce();
    }, { once:true, passive:false });
    window.addEventListener('resize', () => { if (this.state.running) this.resizeCanvas(); });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BOOTSTRAP
// ═══════════════════════════════════════════════════════════════════════════════
const game = new Game();
game.init();
