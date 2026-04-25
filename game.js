'use strict';

const PLAYER_W = 16;
const PLAYER_H = 18;

const CS = 20;  // tamaño del tile en píxeles
const DEBUG_SENSORS = false;

const GRAVITY    = 900;
const JUMP_VEL  = -380;
const MOVE_ACC  = 1800;
const MOVE_SPD  = 150;
const MAX_FALL = 600;
const DEATH_DUR = 1.0;
const INVIN_DUR = 1.333;
const GRAV_DUR = 3.0;
const FLASH_DUR = 0.133;
const MSG_DUR  = 2.2;
const TARGET_DT = 1 / 60;
const MAX_DT    = 1 / 20;
const FRIC = 0.85;

const PAL = {
  bg: '#04060f',
  floor: '#0e2030',
  floorG: '#1a3a50',
  steel: '#1a2a3a',
  spike: '#ff3040',
  spikeG: '#ff8090',
  ghost: 'rgba(40,180,120,.45)',
  fake: 'rgba(100,80,160,.5)',
  exit: '#00ffcc',
  grav: '#ff00aa',
  player: '#e0f0ff',
  eye: '#00ffcc',
  pupil: '#003020',
  brick: '#8B4513',
  autoPlatform: '#00ffcc',
  patrolPlatform: '#ff6600',
  movingSpike: '#ff00aa',
};

const TAUNTS = [
  'NICE TRY', 'SKILL ISSUE', 'PATHETIC', 'THAT WAS OBVIOUS', 'LOL',
  'ARE YOU EVEN TRYING?', 'PREDICTED', 'L RATIO', 'STILL ALIVE?', 'TOUCH GRASS',
  'JUST STOP', 'PAIN IS INFORMATION', 'COPE', 'YOU FOOL', 'CLASSIC',
  'MAYBE PLAY EASIER', 'WOW...', 'BRUH', 'GET GOOD',
];

function _rnd(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

let actx = null;

function initAudio() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
}

function sfx(type) {
  try {
    if (!actx) return;
    const g = actx.createGain(),
          o = actx.createOscillator();
    o.connect(g);
    g.connect(actx.destination);
    const t = actx.currentTime;
    switch (type) {
      case 'jump':
        o.type = 'square';
        o.frequency.setValueAtTime(220, t);
        o.frequency.exponentialRampToValueAtTime(440, t + 0.08);
        g.gain.setValueAtTime(0.18, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        o.start(t);
        o.stop(t + 0.12);
        break;
      case 'die':
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(440, t);
        o.frequency.exponentialRampToValueAtTime(55, t + 0.35);
        g.gain.setValueAtTime(0.25, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        o.start(t);
        o.stop(t + 0.35);
        break;
      case 'trap':
        o.type = 'square';
        o.frequency.setValueAtTime(880, t);
        o.frequency.exponentialRampToValueAtTime(110, t + 0.15);
        g.gain.setValueAtTime(0.2, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        o.start(t);
        o.stop(t + 0.15);
        break;
      case 'win':
        o.type = 'triangle';
        o.frequency.setValueAtTime(440, t);
        o.frequency.linearRampToValueAtTime(880, t + 0.1);
        o.frequency.linearRampToValueAtTime(1760, t + 0.2);
        g.gain.setValueAtTime(0.22, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        o.start(t);
        o.stop(t + 0.3);
        break;
      case 'troll':
        o.type = 'sine';
        o.frequency.setValueAtTime(660, t);
        o.frequency.exponentialRampToValueAtTime(220, t + 0.4);
        g.gain.setValueAtTime(0.2, t);
        g.gain.setValueAtTime(0.2, t + 0.35);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        o.start(t);
        o.stop(t + 0.5);
        break;
      case 'land':
        o.type = 'square';
        o.frequency.setValueAtTime(120, t);
        o.frequency.exponentialRampToValueAtTime(60, t + 0.05);
        g.gain.setValueAtTime(0.12, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
        o.start(t);
        o.stop(t + 0.06);
        break;
      case 'whoosh':
        o.type = 'sine';
        o.frequency.setValueAtTime(200, t);
        o.frequency.exponentialRampToValueAtTime(80, t + 0.18);
        g.gain.setValueAtTime(0.15, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        o.start(t);
        o.stop(t + 0.2);
        break;
    }
  } catch (e) {}
}

function _aabbOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

const FSM = Object.freeze({ IDLE: 0, TRIGGERED: 1, ANIMATING: 2, RESET: 3 });

class Entity {
  constructor(def) {
    this.id = def.id;
    this.type = def.type;
    this.col = def.col ?? 0;
    this.row = def.row ?? 0;
    this.trigger = def.trigger ?? null;
    this.triggerDelay = def.triggerDelay ?? 0.05;
    this.resetDelay = def.resetDelay ?? -1;
    this.oneShot = def.oneShot ?? true;
    this.x = this.col * CS;
    this.y = this.row * CS;
    this.state = FSM.IDLE;
    this.timer = 0;
    this._dead = false;
  }

  update(dt, game) {
    switch (this.state) {
      case FSM.IDLE:
        if (this.trigger && this._sensorActive(game)) {
          this.state = FSM.TRIGGERED;
          this.timer = 0;
          sfx('trap');
          this.onTrigger(game);
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

  draw(ctx, game) {
    if (DEBUG_SENSORS && this.trigger && this.state === FSM.IDLE) {
      this._drawSensorDebug(ctx);
    }
    this.onDraw(ctx, game);
  }

  onTrigger(game) {}
  onUpdate(dt, game) { return true; }
  onReset(game) {}
  onDraw(ctx, game) {}

  _sensorActive(game) {
    if (!game.state.player) return false;
    const p = game.state.player;
    const px = (p.x + PLAYER_W / 2) / CS;
    const py = (p.y + PLAYER_H / 2) / CS;
    const tr = this.trigger;
    if (tr.radius !== undefined) {
      return Math.hypot(px - (tr.col + 0.5), py - (tr.row + 0.5)) <= tr.radius;
    }
    const tw = tr.w ?? 1, th = tr.h ?? 1;
    return px >= tr.col && px <= tr.col + tw && py >= tr.row && py <= tr.row + th;
  }

  _drawSensorDebug(ctx) {
    const tr = this.trigger;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,0,0.55)';
    ctx.lineWidth = 0.8;
    ctx.setLineDash([3, 3]);
    if (tr.radius !== undefined) {
      ctx.beginPath();
      ctx.arc((tr.col + 0.5) * CS, (tr.row + 0.5) * CS, tr.radius * CS, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      const tw = tr.w ?? 1, th = tr.h ?? 1;
      ctx.strokeRect(tr.col * CS, tr.row * CS, tw * CS, th * CS);
    }
    ctx.setLineDash([]);
    ctx.restore();
  }
}

class SpikeLauncher extends Entity {
  constructor(def) {
    super(def);
    this.speed = def.speed ?? 480;
    this.travelDist = def.travelDist ?? CS * 2;
    this._offset = 0;
    this._savedTile = 0;
  }

  onTrigger(game) {
    this._savedTile = game.tileAt(this.col, this.row);
    game.setTile(this.col, this.row, 3);
    this._offset = 0;
    sfx('whoosh');
  }

  onUpdate(dt, game) {
    this._offset = Math.min(this._offset + this.speed * dt, this.travelDist);
    const spikeY = this.y - this._offset;
    const p = game.state.player;
    if (_aabbOverlap(p.x, p.y, PLAYER_W, PLAYER_H, this.x, spikeY, CS, CS)) {
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
    ctx.moveTo(x + s / 2, y + 2);
    ctx.lineTo(x + s * 0.9, y + s - 2);
    ctx.lineTo(x + s * 0.1, y + s - 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = PAL.spikeG;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const trailH = this._offset * 0.4;
    const grad = ctx.createLinearGradient(0, y + s, 0, y + s + trailH);
    grad.addColorStop(0, 'rgba(255,48,64,0.35)');
    grad.addColorStop(1, 'rgba(255,48,64,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x + 4, y + s, s - 8, trailH);
  }
}

class VanishPlatform extends Entity {
  constructor(def) {
    super(def);
    this.fadeTime = def.fadeTime ?? 0.6;
    this.triggerDelay = 0.08;
    this._elapsed = 0;
    this._blinkTimer = 0;
  }

  onTrigger(game) {
    this._elapsed = 0;
    this._blinkTimer = 0;
  }

  onUpdate(dt, game) {
    this._elapsed += dt;
    this._blinkTimer += dt;
    const progress = this._elapsed / this.fadeTime;
    if (progress > 0.6) {
      const blinkRate = 0.045 * (1 - progress + 0.1);
      const visible = Math.floor(this._blinkTimer / blinkRate) % 2 === 0;
      game.setTile(this.col, this.row, visible ? 1 : 0);
    }
    if (this._elapsed >= this.fadeTime) {
      game.setTile(this.col, this.row, 0);
      return true;
    }
    return false;
  }

  onReset(game) {
    game.setTile(this.col, this.row, 1);
    this._elapsed = 0;
  }

  onDraw(ctx) {
    if (this.state !== FSM.ANIMATING) return;
    const alpha = Math.max(0, 1 - this._elapsed / this.fadeTime);
    ctx.save();
    ctx.globalAlpha = alpha * 0.6;
    ctx.fillStyle = '#ff8040';
    ctx.fillRect(this.x, this.y, CS, CS);
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

class DropBlock extends Entity {
  constructor(def) {
    super(def);
    this._fy = this.row * CS;
    this._speed = 120;
    this._accel = 1440;
    this._maxSpd = 840;
  }

  onTrigger(game) {
    this._fy = this.row * CS;
    this._speed = 120;
    sfx('whoosh');
  }

  onUpdate(dt, game) {
    this._speed = Math.min(this._speed + this._accel * dt, this._maxSpd);
    this._fy += this._speed * dt;
    const row = Math.floor(this._fy / CS);
    const p = game.state.player;
    const pc = Math.floor((p.x + PLAYER_W / 2) / CS);
    if (pc === this.col && Math.abs(p.y + PLAYER_H / 2 - this._fy) < CS * 1.5) {
      game.killPlayer();
    }
    if (row >= game.state.lvl.ph - 1 || game.isSolid(game.tileAt(this.col, row + 1))) {
      game.setTile(this.col, row, 1);
      return true;
    }
    return false;
  }

  onDraw(ctx) {
    if (this.state !== FSM.ANIMATING && this.state !== FSM.TRIGGERED) return;
    const x = this.col * CS, y = this._fy, s = CS;
    const g = ctx.createLinearGradient(x, y, x, y + s);
    g.addColorStop(0, '#e04020');
    g.addColorStop(1, '#802010');
    ctx.fillStyle = g;
    ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
    ctx.strokeStyle = '#ff8060';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 1, y + 1, s - 2, s - 2);
    ctx.fillStyle = 'rgba(255,80,32,0.15)';
    ctx.fillRect(x + 3, y + s, s - 6, 10);
  }
}

class CrushCeiling extends Entity {
  constructor(def) {
    super(def);
    this.targetRow = def.targetRow ?? this.row + 4;
    this.speed = def.speed ?? 600;
    this._fy = this.row * CS;
    this._origRow = this.row;
    this._dir = 1;
  }

  onTrigger(game) {
    this._fy = this._origRow * CS;
    this._dir = 1;
    sfx('whoosh');
  }

  onUpdate(dt, game) {
    this._fy += this.speed * this._dir * dt;
    const p = game.state.player;
    if (this._dir === 1) {
      if (_aabbOverlap(p.x, p.y, PLAYER_W, PLAYER_H, this.x, this._fy, CS, (this.targetRow - this._origRow + 1) * CS)) {
        game.killPlayer();
      }
      if (this._fy >= this.targetRow * CS) {
        this._fy = this.targetRow * CS;
        this._dir = -1;
        return true;
      }
    }
    return false;
  }

  onReset(game) {
    this._fy = this._origRow * CS;
    this._dir = 1;
  }

  onDraw(ctx) {
    if (this.state !== FSM.ANIMATING && this.state !== FSM.TRIGGERED) return;
    const x = this.x, y = this._fy, h = (this.targetRow - this._origRow + 1) * CS;
    const grad = ctx.createLinearGradient(x, y, x, y + CS);
    grad.addColorStop(0, '#223348');
    grad.addColorStop(1, '#0e1e2e');
    ctx.fillStyle = grad;
    ctx.fillRect(x + 1, y + 1, CS - 2, CS - 2);
    ctx.strokeStyle = '#4488aa';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 1, y + 1, CS - 2, CS - 2);
    ctx.strokeStyle = 'rgba(255,200,0,0.6)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.strokeRect(x + 3, y + 3, CS - 6, CS - 6);
    ctx.setLineDash([]);
    const shadowH = Math.min(this.targetRow * CS - this._fy, 40);
    if (shadowH > 0) {
      const sg = ctx.createLinearGradient(0, y + CS, 0, y + CS + shadowH);
      sg.addColorStop(0, 'rgba(0,0,0,0.4)');
      sg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(x, y + CS, CS, shadowH);
    }
  }
}

class PatrolSpike extends Entity {
  constructor(def) {
    super(def);
    this.colEnd = def.colEnd ?? this.col + 3;
    this.speed = def.speed ?? 120;
    this._px = this.x;
    this._dir = 1;
    this.state = FSM.ANIMATING;
  }

  update(dt, game) {
    this._px += this.speed * this._dir * dt;
    const rightLimit = this.colEnd * CS;
    const leftLimit = this.col * CS;
    if (this._px >= rightLimit) { this._px = rightLimit; this._dir = -1; }
    if (this._px <= leftLimit) { this._px = leftLimit; this._dir = 1; }
    const p = game.state.player;
    if (_aabbOverlap(p.x, p.y, PLAYER_W, PLAYER_H, this._px, this.y, CS, CS)) {
      game.killPlayer();
    }
  }

  onDraw(ctx) {
    const x = this._px, y = this.y, s = CS;
    ctx.fillStyle = PAL.spike;
    ctx.beginPath();
    ctx.moveTo(this._dir > 0 ? x + s - 2 : x + 2, y + s / 2);
    ctx.lineTo(x + s * 0.5, y + 4);
    ctx.lineTo(this._dir > 0 ? x + 2 : x + s - 2, y + s / 2);
    ctx.lineTo(x + s * 0.5, y + s - 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = PAL.spikeG;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    const trailW = Math.min(this.speed * 0.05, 14) * (this._dir > 0 ? 1 : -1);
    const grad = ctx.createLinearGradient(x + s / 2, 0, x + s / 2 - trailW, 0);
    grad.addColorStop(0, 'rgba(255,48,64,0.3)');
    grad.addColorStop(1, 'rgba(255,48,64,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(
      this._dir > 0 ? x - Math.abs(trailW) : x + s,
      y + 4, Math.abs(trailW), s - 8
    );
  }
}

class GravityZone extends Entity {
  constructor(def) {
    super(def);
    this.duration = def.duration ?? GRAV_DUR;
  }

  onTrigger(game) {
    game.state.gravFlip = true;
    game.state.gravTimer = this.duration;
    game._showMsg('GRAVITY INVERTED');
  }

  onUpdate(dt, game) { return true; }

  onDraw(ctx) {
    if (this.state !== FSM.IDLE || !this.trigger) return;
    const tr = this.trigger;
    const pulse = Math.sin(Date.now() * 0.004) * 0.5 + 0.5;
    if (tr.radius !== undefined) {
      ctx.strokeStyle = `rgba(255,0,170,${pulse * 0.3})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.arc((tr.col + 0.5) * CS, (tr.row + 0.5) * CS, tr.radius * CS, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      const tw = tr.w ?? 1, th = tr.h ?? 1;
      ctx.strokeStyle = `rgba(255,0,170,${pulse * 0.25})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.strokeRect(tr.col * CS, tr.row * CS, tw * CS, th * CS);
      ctx.setLineDash([]);
    }
  }
}

class FakeExit extends Entity {
  constructor(def) {
    super(def);
    this.triggerDelay = 0;
    this.resetDelay = def.resetDelay ?? 1.5;
    this.oneShot = def.oneShot ?? false;
  }

  onTrigger(game) {
    game.setTile(this.col, this.row, 3);
    game._showMsg('NICE TRY — NOT THE EXIT');
    sfx('troll');
  }

  onUpdate(dt, game) { return true; }

  onReset(game) {
    game.setTile(this.col, this.row, 8);
  }
}

class TimedSpikes extends Entity {
  constructor(def) {
    super(def);
    this.upTime = def.upTime ?? 1.0;
    this.downTime = def.downTime ?? 1.0;
    this._cycleTime = this.upTime + this.downTime;
    this._elapsed = 0;
    this._active = false;
    this._origTile = def.origTile ?? 0;
  }

  onTrigger(game) {
    this._elapsed = 0;
    this._active = true;
    this._origTile = game.tileAt(this.col, this.row);
    game.setTile(this.col, this.row, 3);
  }

  onUpdate(dt, game) {
    this._elapsed += dt;
    const cyclePos = this._elapsed % this._cycleTime;
    const shouldBeActive = cyclePos < this.upTime;

    if (shouldBeActive !== this._active) {
      this._active = shouldBeActive;
      game.setTile(this.col, this.row, this._active ? 3 : this._origTile);
    }

    const p = game.state.player;
    if (this._active && _aabbOverlap(p.x, p.y, PLAYER_W, PLAYER_H, this.x, this.y, CS, CS)) {
      game.killPlayer();
    }

    return false;
  }

  onReset(game) {
    this._active = false;
    this._elapsed = 0;
    game.setTile(this.col, this.row, this._origTile);
  }

  onDraw(ctx) {
    if (!this._active) return;
    const x = this.x, y = this.y, s = CS;
    ctx.fillStyle = PAL.spike;
    ctx.beginPath();
    ctx.moveTo(x + s / 2, y + 2);
    ctx.lineTo(x + s - 2, y + s / 2);
    ctx.lineTo(x + s / 2, y + s - 2);
    ctx.lineTo(x + 2, y + s / 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = PAL.spikeG;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

class MovingPlatform extends Entity {
  constructor(def) {
    super(def);
    this.colEnd = def.colEnd ?? this.col + 4;
    this.rowEnd = def.rowEnd ?? this.row;
    this.speed = def.speed ?? 80;
    this._px = this.x;
    this._py = this.y;
    this._dirX = def.dirX ?? 1;
    this._dirY = def.dirY ?? 0;
    this._origCol = this.col;
    this._origRow = this.row;
  }

  onTrigger(game) {
    this._px = this._origCol * CS;
    this._py = this._origRow * CS;
    this._dirX = this._dirX || 1;
    this._dirY = this._dirY || 0;
  }

  onUpdate(dt, game) {
    const endX = this.colEnd * CS;
    const endY = this.rowEnd * CS;

    if (this._dirX !== 0) {
      this._px += this.speed * this._dirX * dt;
      if (this._dirX > 0 && this._px >= endX) {
        this._px = endX;
        this._dirX = -1;
      } else if (this._dirX < 0 && this._px <= this._origCol * CS) {
        this._px = this._origCol * CS;
        this._dirX = 1;
      }
    }

    if (this._dirY !== 0) {
      this._py += this.speed * this._dirY * dt;
      if (this._dirY > 0 && this._py >= endY) {
        this._py = endY;
        this._dirY = -1;
      } else if (this._dirY < 0 && this._py <= this._origRow * CS) {
        this._py = this._origRow * CS;
        this._dirY = 1;
      }
    }

    const p = game.state.player;
    if (_aabbOverlap(p.x, p.y + PLAYER_H - 4, PLAYER_W, 4, this._px + 2, this._py, CS - 4, CS)) {
      p.x += this.speed * this._dirX * dt;
      p.y += this.speed * this._dirY * dt;
    }

    if (_aabbOverlap(p.x, p.y, PLAYER_W, PLAYER_H, this._px, this._py, CS, CS)) {
      game.killPlayer();
    }

    return false;
  }

  onReset(game) {
    this._px = this._origCol * CS;
    this._py = this._origRow * CS;
    this._dirX = 1;
    this._dirY = 0;
  }

  onDraw(ctx) {
    const x = this._px, y = this._py, s = CS;
    const grad = ctx.createLinearGradient(x, y, x, y + s);
    grad.addColorStop(0, '#3a5a7a');
    grad.addColorStop(1, '#1a3a5a');
    ctx.fillStyle = grad;
    ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
    ctx.strokeStyle = '#6a9aba';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 1, y + 1, s - 2, s - 2);
    ctx.fillStyle = '#8abade';
    ctx.fillRect(x + 3, y + 3, s - 6, 2);
    ctx.fillRect(x + 3, y + s - 5, s - 6, 2);
  }
}

class FallingBricks extends Entity {
  constructor(def) {
    super(def);
    this.rowCount = def.rowCount ?? 1;
    this.fallSpeed = def.fallSpeed ?? 600;
    this.shakeTime = def.shakeTime ?? 0.3;
    this._fy = this.row * CS;
    this._origRow = this.row;
    this._shaking = false;
    this._shakeTimer = 0;
    this._fallen = false;
    this._falling = false;
    this._savedTiles = [];
  }

  onTrigger(game) {
    for (let i = 0; i < this.rowCount; i++) {
      this._savedTiles[i] = game.tileAt(this.col, this._origRow - i);
    }
    this._shaking = true;
    this._shakeTimer = 0;
    sfx('whoosh');
  }

  onUpdate(dt, game) {
    const p = game.state.player;

    if (this._shaking) {
      this._shakeTimer += dt;
      if (this._shakeTimer >= this.shakeTime) {
        this._shaking = false;
        this._falling = true;
        this._fy = this._origRow * CS;
      }
    }

    if (this._falling) {
      this._fy += this.fallSpeed * dt;
      const checkRow = Math.floor(this._fy / CS);
      if (checkRow >= game.state.lvl.ph - 1 || game.isSolid(game.tileAt(this.col, checkRow + 1))) {
        for (let i = 0; i < this.rowCount; i++) {
          game.setTile(this.col, this._origRow - i, 1);
        }
        return true;
      }
    }

    if (this._falling) {
      for (let i = 0; i < this.rowCount; i++) {
        const brickY = this._fy - i * CS;
        if (_aabbOverlap(p.x, p.y, PLAYER_W, PLAYER_H, this.col * CS, brickY, CS, CS)) {
          game.killPlayer();
        }
      }
    }

    return false;
  }

  onReset(game) {
    this._fy = this._origRow * CS;
    this._shaking = false;
    this._shakeTimer = 0;
    this._fallen = false;
    this._falling = false;
    for (let i = 0; i < this.rowCount; i++) {
      if (this._savedTiles[i] !== undefined) {
        game.setTile(this.col, this._origRow - i, this._savedTiles[i]);
      }
    }
  }

  onDraw(ctx) {
    if (this.state !== FSM.ANIMATING && this.state !== FSM.TRIGGERED) return;
    for (let i = 0; i < this.rowCount; i++) {
      const x = this.col * CS;
      const y = this._shaking ? (this._origRow - i) * CS + Math.sin(Date.now() * 0.05 + i) * 2 : this._fy - i * CS;
      const s = CS;
      const g = ctx.createLinearGradient(x, y, x, y + s);
      g.addColorStop(0, '#8B4513');
      g.addColorStop(1, '#5D2E0C');
      ctx.fillStyle = g;
      ctx.fillRect(x + 2, y + 2, s - 4, s - 4);
      ctx.strokeStyle = '#A0522D';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 2, y + 2, s - 4, s - 4);
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 4, y + s / 2);
      ctx.lineTo(x + s - 4, y + s / 2);
      ctx.stroke();
    }
  }
}

class MovingSpikes extends Entity {
  constructor(def) {
    super(def);
    this.upTime = def.upTime ?? 0.5;
    this.downTime = def.downTime ?? 1.0;
    this._cycleTime = this.upTime + this.downTime;
    this._elapsed = 0;
    this._active = false;
    this._origTile = def.origTile ?? 0;
    this.direction = def.direction ?? 'up';
  }

  onTrigger(game) {
    this._elapsed = 0;
    this._active = true;
    this._origTile = game.tileAt(this.col, this.row);
    game.setTile(this.col, this.row, 3);
  }

  onUpdate(dt, game) {
    this._elapsed += dt;
    const cyclePos = this._elapsed % this._cycleTime;
    const shouldBeActive = cyclePos < this.upTime;

    if (shouldBeActive !== this._active) {
      this._active = shouldBeActive;
      game.setTile(this.col, this.row, this._active ? 3 : this._origTile);
    }

    const p = game.state.player;
    if (this._active && _aabbOverlap(p.x, p.y, PLAYER_W, PLAYER_H, this.x, this.y, CS, CS)) {
      game.killPlayer();
    }

    return false;
  }

  onReset(game) {
    this._active = false;
    this._elapsed = 0;
    game.setTile(this.col, this.row, this._origTile);
  }

  onDraw(ctx) {
    if (!this._active) return;
    const x = this.x, y = this.y, s = CS;
    ctx.fillStyle = PAL.spike;
    if (this.direction === 'up') {
      ctx.beginPath();
      ctx.moveTo(x + s / 2, y + 2);
      ctx.lineTo(x + s - 2, y + s - 2);
      ctx.lineTo(x + 2, y + s - 2);
      ctx.closePath();
    } else if (this.direction === 'down') {
      ctx.beginPath();
      ctx.moveTo(x + s / 2, y + s - 2);
      ctx.lineTo(x + s - 2, y + 2);
      ctx.lineTo(x + 2, y + 2);
      ctx.closePath();
    } else {
      ctx.beginPath();
      ctx.moveTo(x + 2, y + s / 2);
      ctx.lineTo(x + s - 2, y + 2);
      ctx.lineTo(x + s - 2, y + s - 2);
      ctx.closePath();
    }
    ctx.fill();
    ctx.strokeStyle = PAL.spikeG;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

class AutoPlatform extends Entity {
  constructor(def) {
    super(def);
    this.colEnd = def.colEnd ?? this.col + 4;
    this.rowEnd = def.rowEnd ?? this.row;
    this.speed = def.speed ?? 100;
    this._px = this.x;
    this._py = this.y;
    this._dirX = def.dirX ?? 1;
    this._dirY = def.dirY ?? 0;
    this._origCol = this.col;
    this._origRow = this.row;
    this.state = FSM.ANIMATING;
  }

  update(dt, game) {
    const endX = this.colEnd * CS;
    const endY = this.rowEnd * CS;

    if (this._dirX !== 0) {
      this._px += this.speed * this._dirX * dt;
      if (this._dirX > 0 && this._px >= endX) {
        this._px = endX;
        this._dirX = -1;
      } else if (this._dirX < 0 && this._px <= this._origCol * CS) {
        this._px = this._origCol * CS;
        this._dirX = 1;
      }
    }

    if (this._dirY !== 0) {
      this._py += this.speed * this._dirY * dt;
      if (this._dirY > 0 && this._py >= endY) {
        this._py = endY;
        this._dirY = -1;
      } else if (this._dirY < 0 && this._py <= this._origRow * CS) {
        this._py = this._origRow * CS;
        this._dirY = 1;
      }
    }

    const p = game.state.player;
    if (_aabbOverlap(p.x, p.y + PLAYER_H - 4, PLAYER_W, 4, this._px + 2, this._py, CS - 4, CS)) {
      p.x += this.speed * this._dirX * dt;
      p.y += this.speed * this._dirY * dt;
    }
  }

  onDraw(ctx) {
    const x = this._px, y = this._py, s = CS;
    const g = ctx.createLinearGradient(x, y, x, y + s);
    g.addColorStop(0, '#00ffcc');
    g.addColorStop(1, '#008866');
    ctx.fillStyle = g;
    ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
    ctx.strokeStyle = '#00ffcc';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 1, y + 1, s - 2, s - 2);
    ctx.fillStyle = '#aaffee';
    ctx.fillRect(x + 3, y + 3, s - 6, 2);
  }
}

class SpikeWall extends Entity {
  constructor(def) {
    super(def);
    this.colCount = def.colCount ?? 1;
    this.direction = def.direction ?? 'right';
    this.triggerDelay = 0.05;
    this.oneShot = def.oneShot ?? true;
    this._activated = false;
  }

  onTrigger(game) {
    if (this._activated) return;
    this._activated = true;
    sfx('trap');

    const startX = this.col * CS;
    const startY = this.row * CS;

    for (let i = 0; i < this.colCount; i++) {
      let tx = startX, ty = startY;
      if (this.direction === 'right') tx += i * CS;
      else if (this.direction === 'left') tx -= i * CS;
      else if (this.direction === 'down') ty += i * CS;
      else if (this.direction === 'up') ty -= i * CS;

      const tc = Math.floor(tx / CS);
      const tr = Math.floor(ty / CS);
      game.setTile(tc, tr, 3);
    }
  }

  onUpdate(dt, game) {
    return this.oneShot && this._activated;
  }

  onDraw(ctx) {}
}

class PatrolPlatform extends Entity {
  constructor(def) {
    super(def);
    this.colStart = def.colStart ?? this.col;
    this.colEnd = def.colEnd ?? this.col + 5;
    this.speed = def.speed ?? 90;
    this._px = this.x;
    this._dir = 1;
  }

  update(dt, game) {
    this._px += this.speed * this._dir * dt;
    if (this._px >= this.colEnd * CS) { this._px = this.colEnd * CS; this._dir = -1; }
    if (this._px <= this.colStart * CS) { this._px = this.colStart * CS; this._dir = 1; }

    const p = game.state.player;
    if (_aabbOverlap(p.x, p.y + PLAYER_H - 4, PLAYER_W, 4, this._px + 2, this.y, CS - 4, CS)) {
      p.x += this.speed * this._dir * dt;
    }
  }

  onDraw(ctx) {
    const x = this._px, y = this.y, s = CS;
    const g = ctx.createLinearGradient(x, y, x, y + s);
    g.addColorStop(0, '#ff6600');
    g.addColorStop(1, '#993300');
    ctx.fillStyle = g;
    ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
    ctx.strokeStyle = '#ff9900';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 1, y + 1, s - 2, s - 2);
  }
}

const ENTITY_TYPES = {
  spike_launcher: SpikeLauncher,
  vanish_platform: VanishPlatform,
  drop_block: DropBlock,
  crush_ceiling: CrushCeiling,
  patrol_spike: PatrolSpike,
  gravity_zone: GravityZone,
  fake_exit: FakeExit,
  timed_spikes: TimedSpikes,
  moving_platform: MovingPlatform,
  falling_bricks: FallingBricks,
  moving_spikes: MovingSpikes,
  auto_platform: AutoPlatform,
  spike_wall: SpikeWall,
  patrol_platform: PatrolPlatform,
};

function createEntity(def) {
  const Cls = ENTITY_TYPES[def.type];
  if (!Cls) {
    console.warn(`[FLUXTRAP FSM] Tipo de entidad desconocido: "${def.type}"`);
    return null;
  }
  return new Cls(def);
}

class Game {
  constructor() {
    this.canvas = document.getElementById('c');
    this.ctx = this.canvas.getContext('2d');
    this.levels = [];
    this.SCALE = 1;
    this.state = {
      lvlIdx: 0,
      deaths: 0,
      hi: +(localStorage.getItem('ft_hi') || 0),
      player: null,
      map: null,
      lvl: null,
      triggers: [],
      firedTriggers: new Set(),
      ghostTiles: new Map(),
      spikeReveal: new Set(),
      fallingBlocks: [],
      gravFlip: false,
      gravTimer: 0,
      running: false,
      paused: false,
      dying: false,
      deathTimer: 0,
      flashTimer: 0,
      invinTimer: 0,
      entities: [],
    };
    this.keys = { left: false, right: false, jump: false };
    this._lastTS = 0;
    this._bindInput();
    this._bindButtons();
    this._bindUI();
  }

  async init() {
    console.log('[FLUXTRAP] Iniciando...');
    try {
      const res = await fetch('./mapa.json?v=' + Date.now());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.levels = await res.json();
      console.log('[FLUXTRAP] Niveles cargados:', this.levels.length);
    } catch (e) {
      console.error('[FLUXTRAP] No se pudo cargar mapa.json:', e);
    }
    this.resizeCanvas();
    requestAnimationFrame(ts => this._loop(ts));
  }

  start() {
    console.log('[FLUXTRAP] Start!');
    initAudio();
    this._hideOverlay();
    this.loadLevel(0);
    console.log('[FLUXTRAP] Nivel cargado, canvas:', this.canvas.width, 'x', this.canvas.height);
    this.state.running = true;
    this.state.paused = false;
    this._lastTS = performance.now();
  }

  loadLevel(idx) {
    const s = this.state;
    const lvl = this.levels[idx];
    if (!lvl) return;
    s.lvlIdx = idx;
    s.lvl = lvl;
    s.map = [...lvl.map];
    s.triggers = lvl.triggers ? lvl.triggers.map(t => ({ ...t })) : [];
    s.firedTriggers = new Set();
    s.ghostTiles = new Map();
    s.spikeReveal = new Set();
    s.fallingBlocks = [];
    s.gravFlip = false;
    s.gravTimer = 0;
    s.dying = false;
    s.deathTimer = 0;
    s.invinTimer = 0;
    s.entities = [];
    if (lvl.entities) {
      for (const def of lvl.entities) {
        const ent = createEntity(def);
        if (ent) s.entities.push(ent);
      }
    }
    s.player = {
      x: lvl.sx * CS + CS / 2 - PLAYER_W / 2,
      y: lvl.sy * CS - PLAYER_H,
      vx: 0,
      vy: 0,
      onGround: false,
      eyeAng: 0,
      stretch: 1,
      lean: 0,
      blinking: 0,
      trailPts: [],
    };
    this.resizeCanvas();
    document.getElementById('hv-lvl').textContent = String(idx + 1).padStart(2, '0');
  }

  resizeCanvas() {
    const arena = document.getElementById('arena');
    const aw = arena.clientWidth, ah = arena.clientHeight;
    if (aw === 0 || ah === 0) {
      setTimeout(() => this.resizeCanvas(), 100);
      return;
    }
    const lvl = this.levels[this.state.lvlIdx];
    if (!lvl) return;
    const gw = lvl.pw * CS, gh = lvl.ph * CS;
    this.SCALE = Math.min(aw / gw, ah / gh, 2);
    this.canvas.width = gw;
    this.canvas.height = gh;
    this.canvas.style.width = Math.floor(gw * this.SCALE) + 'px';
    this.canvas.style.height = Math.floor(gh * this.SCALE) + 'px';
  }

  tileAt(col, row) {
    const lvl = this.state.lvl;
    if (col < 0 || row < 0 || col >= lvl.pw || row >= lvl.ph) return 1;
    return this.state.map[row * lvl.pw + col];
  }

  setTile(col, row, val) {
    const lvl = this.state.lvl;
    if (col < 0 || row < 0 || col >= lvl.pw || row >= lvl.ph) return;
    this.state.map[row * lvl.pw + col] = val;
  }

  isSolid(t) { return t === 1 || t === 5 || t === 6; }

  _sweepX(x, y, dx) {
    if (dx === 0) return { nx: x, hitWall: false };
    const nx = x + dx;
    const col = dx > 0 ? Math.floor((nx + PLAYER_W - 1) / CS) : Math.floor(nx / CS);
    const r0 = Math.floor(y / CS), r1 = Math.floor((y + PLAYER_H - 1) / CS);
    for (let r = r0; r <= r1; r++) {
      const t = this.tileAt(col, r);
      this._handleSpecialTile(t, col, r);
      if (!this.isSolid(t)) continue;
      return { nx: dx > 0 ? col * CS - PLAYER_W : (col + 1) * CS, hitWall: true };
    }
    return { nx, hitWall: false };
  }

  _sweepY(x, y, dy) {
    if (dy === 0) return { ny: y, hitFloor: false, hitCeiling: false };
    const ny = y + dy;
    const row = dy > 0 ? Math.floor((ny + PLAYER_H - 1) / CS) : Math.floor(ny / CS);
    const c0 = Math.floor(x / CS), c1 = Math.floor((x + PLAYER_W - 1) / CS);
    for (let c = c0; c <= c1; c++) {
      const t = this.tileAt(c, row);
      this._handleSpecialTile(t, c, row);
      if (!this.isSolid(t)) continue;
      return {
        ny: dy > 0 ? row * CS - PLAYER_H : (row + 1) * CS,
        hitFloor: dy > 0,
        hitCeiling: dy < 0,
      };
    }
    return { ny, hitFloor: false, hitCeiling: false };
  }

  _handleSpecialTile(t, c, r) {
    const gk = `${c},${r}`;
    if (t === 4 && !this.state.spikeReveal.has(gk)) {
      this.state.spikeReveal.add(gk);
      this.setTile(c, r, 3);
      sfx('trap');
    }
    if (t === 7 && !this.state.firedTriggers.has(gk)) {
      this.state.firedTriggers.add(gk);
      this.state.gravFlip = true;
      this.state.gravTimer = GRAV_DUR;
      this._showMsg('GRAVITY INVERTED');
      sfx('trap');
    }
  }

  _checkSpecialUnderfoot(x, y, vy) {
    const r = Math.floor((y + PLAYER_H) / CS);
    const c0 = Math.floor(x / CS), c1 = Math.floor((x + PLAYER_W - 1) / CS);
    for (let c = c0; c <= c1; c++) {
      const t = this.tileAt(c, r - 1), gk = `${c},${r - 1}`;
      if (t === 6) {
        const cnt = (this.state.ghostTiles.get(gk) || 0) + 1;
        this.state.ghostTiles.set(gk, cnt);
        if (cnt > 4) { this.setTile(c, r - 1, 0); this.state.ghostTiles.delete(gk); sfx('trap'); }
      }
      if (t === 5 && vy > 0 && !this.state.firedTriggers.has('f5' + gk)) {
        this.state.firedTriggers.add('f5' + gk);
        setTimeout(() => this.setTile(c, r - 1, 0), 300);
        sfx('trap');
      }
    }
  }

  touchesSpike(x, y) {
    const c0 = Math.floor(x / CS), c1 = Math.floor((x + PLAYER_W - 1) / CS);
    const r0 = Math.floor(y / CS), r1 = Math.floor((y + PLAYER_H - 1) / CS);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const t = this.tileAt(c, r);
      if (t === 3 || t === 4) return true;
    }
    return false;
  }

  checkTriggers() {
    const p = game.state.player;
    const pc = (p.x + PLAYER_W / 2) / CS, pr = (p.y + PLAYER_H / 2) / CS;
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
      this.state.fallingBlocks.push({ c: tr.blockCol, fy: 0, speed: 120, landed: false });
    else if (tr.action === 'spike_wall')
      for (const c of tr.cols) this.setTile(c, tr.row, 3);
    else if (tr.action === 'reveal_spikes')
      for (let r = 0; r < this.state.lvl.ph; r++)
        for (let c = 0; c < this.state.lvl.pw; c++)
          if (this.tileAt(c, r) === 4) this.setTile(c, r, 3);
    else if (tr.action === 'gravity_flip') {
      this.state.gravFlip = true;
      this.state.gravTimer = GRAV_DUR;
      this._showMsg('GRAVITY INVERTED');
    }
  }

  _updateFallingBlocks(dt) {
    const ACC = 1440, MAX = 840;
    for (let i = this.state.fallingBlocks.length - 1; i >= 0; i--) {
      const fb = this.state.fallingBlocks[i];
      if (fb.landed) continue;
      fb.speed = Math.min(fb.speed + ACC * dt, MAX);
      fb.fy += fb.speed * dt;
      const row = Math.floor(fb.fy / CS);
      if (row >= this.state.lvl.ph - 1 || this.isSolid(this.tileAt(fb.c, row + 1))) {
        this.setTile(fb.c, row, 1);
        this.state.fallingBlocks.splice(i, 1);
        const p = game.state.player;
        const pc = Math.floor((p.x + PLAYER_W / 2) / CS);
        if (pc === fb.c && Math.abs(p.y + PLAYER_H / 2 - fb.fy) < CS * 1.5) this.killPlayer();
      }
    }
  }

  _updateEntities(dt) {
    const ents = this.state.entities;
    for (let i = ents.length - 1; i >= 0; i--) {
      ents[i].update(dt, this);
      if (ents[i]._dead) ents.splice(i, 1);
    }
  }

  killPlayer() {
    const s = this.state;
    if (s.dying || s.invinTimer > 0) return;
    s.dying = true;
    s.deathTimer = DEATH_DUR;
    s.deaths++;
    s.flashTimer = FLASH_DUR;
    sfx('die');
    this._showMsg(_rnd(TAUNTS));
    document.getElementById('hv-deaths').textContent = s.deaths;
    const arena = document.getElementById('arena');
    arena.style.animation = 'shake .25s';
    setTimeout(() => arena.style.animation = '', 280);
  }

  respawn() {
    const lvl = this.state.lvl, p = this.state.player;
    p.x = lvl.sx * CS + CS / 2 - PLAYER_W / 2;
    p.y = lvl.sy * CS - PLAYER_H;
    p.vx = 0;
    p.vy = 0;
    p.onGround = false;
    p.eyeAng = 0;
    p.stretch = 1;
    p.lean = 0;
    p.trailPts = [];
    this.state.dying = false;
    this.state.invinTimer = INVIN_DUR;
    this.state.gravFlip = false;
    this.state.gravTimer = 0;
  }

  handleExit(ec, er) {
    if (Math.random() < 0.5) {
      this.setTile(ec, er, 4);
      sfx('troll');
      this._showMsg('NICE TRY - NOT THE EXIT');
      setTimeout(() => this.setTile(ec, er, 8), 1500);
      return;
    }
    sfx('win');
    if (this.state.lvlIdx < this.levels.length - 1) {
      this._showOverlay('ZONE CLEARED', `ZONE ${this.state.lvlIdx + 1} COMPLETE`,
        `Deaths: ${this.state.deaths}`, 'NEXT ZONE', () => {
          this.loadLevel(this.state.lvlIdx + 1);
          this._hideOverlay();
        });
    } else {
      localStorage.setItem('ft_hi', this.state.deaths);
      this._showOverlay('YOU SURVIVED', `Total deaths: ${this.state.deaths}`,
        'ALL ZONES CLEARED', 'PLAY AGAIN', () => {
          this.state.deaths = 0;
          document.getElementById('hv-deaths').textContent = '0';
          this.loadLevel(0);
          this._hideOverlay();
        });
    }
  }

  _loop(ts) {
    requestAnimationFrame(t => this._loop(t));
    const s = this.state;
    if (!s.running || s.paused) return;
    if (this._lastTS === 0) this._lastTS = ts;
    const rawDt = Math.min((ts - this._lastTS) * 0.001, MAX_DT);
    this._lastTS = ts;

    this._physicsStep(TARGET_DT);
    this.render();
  }

  _physicsStep(dt) {
    const s = this.state;
    if (s.flashTimer > 0) s.flashTimer = Math.max(0, s.flashTimer - dt);
    if (s.invinTimer > 0) s.invinTimer = Math.max(0, s.invinTimer - dt);
    if (s.gravTimer > 0) {
      s.gravTimer = Math.max(0, s.gravTimer - dt);
      if (s.gravTimer === 0) { s.gravFlip = false; this._showMsg('GRAVITY RESTORED'); }
    }
    this._updateEntities(dt);
    if (s.dying) {
      s.deathTimer = Math.max(0, s.deathTimer - dt);
      if (s.deathTimer === 0) this.respawn();
      return;
    }
    const p = s.player;
    const gDir = s.gravFlip ? -1 : 1;
    p.vy += GRAVITY * gDir * dt;
    if (Math.abs(p.vy) > MAX_FALL) p.vy = MAX_FALL * Math.sign(p.vy);

    if (this.keys.left) p.vx = -MOVE_SPD;
    else if (this.keys.right) p.vx = MOVE_SPD;
    else p.vx = 0;

    if (this.keys.jump && (p.onGround || s.gravFlip)) {
      p.vy = JUMP_VEL * (s.gravFlip ? -1 : 1);
      p.onGround = false;
      p.stretch = 1.3;
      sfx('jump');
      this.keys.jump = false;
    }

    p.trailPts.push({ x: p.x, y: p.y });
    if (p.trailPts.length > 6) p.trailPts.shift();
    const wasGround = p.onGround;
    const wasY = p.y;
    p.onGround = false;
    const dx = p.vx * dt, dy = p.vy * dt;
    const rx = this._sweepX(p.x, p.y, dx);
    if (rx.hitWall) p.vx = 0;
    p.x = rx.nx;
    const ry = this._sweepY(p.x, p.y, dy);
    if (ry.hitFloor) { 
      p.onGround = true; 
      p.vy = 0; 
      p.y = Math.round(ry.ny);
      p.stretch = 1;
    }
    if (ry.hitCeiling) { p.vy = 0; }
    else p.y = ry.ny;
    
    this._checkSpecialUnderfoot(p.x, p.y, p.vy);
    
    if (!p.onGround) {
      p.stretch = 1 + (p.vy < 0 ? 0.2 : -0.1);
    } else {
      p.stretch = 1;
    }
    p.lean = 0;
    p.eyeAng = 0;
    p.blinking = 0;
    if (this.touchesSpike(p.x, p.y)) this.killPlayer();
    if (p.y > this.canvas.height + CS || p.y < -CS * 2) this.killPlayer();
    this.checkTriggers();
    this._updateFallingBlocks(dt);
    const c0 = Math.floor(p.x / CS), c1 = Math.floor((p.x + PLAYER_W - 1) / CS);
    const r0 = Math.floor(p.y / CS), r1 = Math.floor((p.y + PLAYER_H - 1) / CS);
    outer: for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      if (this.tileAt(c, r) === 8) { this.handleExit(c, r); break outer; }
    }
  }

  render() {
    console.log('[FLUXTRAP] Render - canvas:', this.canvas.width, 'x', this.canvas.height, 'running:', this.state.running);
    this._drawBackground();
    this._drawGravFlipFX();
    const lvl = this.state.lvl;
    for (let r = 0; r < lvl.ph; r++) for (let c = 0; c < lvl.pw; c++) {
      const t = this.tileAt(c, r);
      if (t !== 0) this._drawTile(c, r, t);
    }
    this._drawFallingBlocks();
    for (const ent of this.state.entities) ent.draw(this.ctx, this);
    this._drawPlayer();
    this._drawDeathAnim();
    this._drawFlash();
  }

  _drawBackground() {
    const ctx = this.ctx;
    ctx.fillStyle = PAL.bg;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.strokeStyle = 'rgba(20,40,60,.4)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x < this.canvas.width; x += CS) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < this.canvas.height; y += CS) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.canvas.width, y);
      ctx.stroke();
    }
  }

  _drawGravFlipFX() {
    if (!this.state.gravFlip) return;
    this.ctx.fillStyle = `rgba(255,0,170,${0.04 + Math.sin(Date.now() * 0.01) * 0.02})`;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  _drawFlash() {
    if (this.state.flashTimer > 0) {
      this.ctx.fillStyle = `rgba(255,50,64,${(this.state.flashTimer / FLASH_DUR) * 0.45})`;
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  _drawTile(col, row, t) {
    const ctx = this.ctx, x = col * CS, y = row * CS, s = CS;
    if (t === 1) {
      const g = ctx.createLinearGradient(x, y, x, y + s);
      g.addColorStop(0, PAL.floor);
      g.addColorStop(1, PAL.steel);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(x + 1, y + 1, s - 2, s - 2, 2);
      ctx.fill();
      ctx.strokeStyle = PAL.floorG;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 2, y + 2);
      ctx.lineTo(x + s - 2, y + 2);
      ctx.stroke();
    } else if (t === 3 || t === 4) {
      ctx.fillStyle = PAL.spike;
      const mid = x + s / 2, tip = y + 2, base = y + s - 2, hw = s * 0.4;
      ctx.beginPath();
      ctx.moveTo(mid, tip);
      ctx.lineTo(mid + hw, base);
      ctx.lineTo(mid - hw, base);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = PAL.spikeG;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (t === 5) {
      ctx.fillStyle = PAL.fake;
      ctx.beginPath();
      ctx.roundRect(x + 2, y + 2, s - 4, s - 4, 3);
      ctx.fill();
      ctx.strokeStyle = 'rgba(160,120,255,.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(x + 2, y + 2, s - 4, s - 4);
      ctx.setLineDash([]);
    } else if (t === 6) {
      ctx.fillStyle = PAL.ghost;
      ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
      ctx.strokeStyle = 'rgba(40,255,150,.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.strokeRect(x + 1, y + 1, s - 2, s - 2);
      ctx.setLineDash([]);
    } else if (t === 7) {
      ctx.fillStyle = '#100820';
      ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
      ctx.fillStyle = 'rgba(255,0,170,.25)';
      ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
      ctx.strokeStyle = PAL.grav;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + s / 2, y + 4);
      ctx.lineTo(x + s / 2 - 4, y + 9);
      ctx.lineTo(x + s / 2 + 4, y + 9);
      ctx.closePath();
      ctx.fill();
      ctx.moveTo(x + s / 2, y + s - 4);
      ctx.lineTo(x + s / 2 - 4, y + s - 9);
      ctx.lineTo(x + s / 2 + 4, y + s - 9);
      ctx.closePath();
      ctx.fill();
    } else if (t === 8) {
      const pulse = Math.sin(Date.now() * 0.005) * 0.4 + 0.6;
      ctx.fillStyle = `rgba(0,255,200,${pulse * 0.18})`;
      ctx.fillRect(x, y, s, s);
      ctx.strokeStyle = `rgba(0,255,200,${pulse})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 2, y + 2, s - 4, s - 4);
      ctx.fillStyle = `rgba(0,255,200,${pulse})`;
      ctx.font = `bold ${s * 0.5}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('E', x + s / 2, y + s / 2);
    }
  }

  _drawFallingBlocks() {
    const ctx = this.ctx;
    for (const fb of this.state.fallingBlocks) {
      const x = fb.c * CS, y = fb.fy, s = CS;
      const g = ctx.createLinearGradient(x, y, x, y + s);
      g.addColorStop(0, '#e04020');
      g.addColorStop(1, '#802010');
      ctx.fillStyle = g;
      ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
      ctx.strokeStyle = '#ff8060';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 1, y + 1, s - 2, s - 2);
    }
  }

  _drawPlayer() {
    if (this.state.dying) return;
    const p = this.state.player, ctx = this.ctx;
    const inv = this.state.invinTimer > 0 && Math.floor(this.state.invinTimer / (4 / 60)) % 2 === 0;
    const px = Math.round(p.x), py = Math.round(p.y), w = PLAYER_W, h = PLAYER_H;

    for (let i = 0; i < p.trailPts.length; i++) {
      const tp = p.trailPts[i];
      ctx.fillStyle = `rgba(0,255,200,${(i / p.trailPts.length) * 0.25})`;
      ctx.fillRect(tp.x + 3, tp.y + 3, w - 6, h - 6);
    }
    ctx.save();
    ctx.translate(px + w / 2, py + h / 2);
    if (p.lean) ctx.rotate((p.lean / MOVE_SPD) * 0.08);
    ctx.scale(1 / p.stretch, p.stretch);
    const hw = w / 2, hh = h / 2;
    ctx.fillStyle = inv ? 'rgba(200,240,255,.6)' : PAL.player;
    ctx.beginPath();
    ctx.roundRect(-hw, -hh, w, h, 4);
    ctx.fill();
    ctx.strokeStyle = this.state.gravFlip ? PAL.grav : PAL.eye;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const ex = Math.cos(p.eyeAng) * 3, ey = Math.sin(p.eyeAng) * 2, eR = w * 0.28;
    ctx.fillStyle = PAL.eye;
    ctx.beginPath();
    ctx.arc(ex, ey, eR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PAL.pupil;
    ctx.beginPath();
    ctx.arc(ex + Math.cos(p.eyeAng) * eR * 0.4, ey + Math.sin(p.eyeAng) * eR * 0.4, eR * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    ctx.beginPath();
    ctx.arc(ex - eR * 0.3, ey - eR * 0.3, eR * 0.22, 0, Math.PI * 2);
    ctx.fill();
    if (p.blinking > 0) {
      ctx.fillStyle = PAL.player;
      ctx.fillRect(-hw, -hh, w, h / 2);
    }
    ctx.restore();
    if (this.state.gravFlip) {
      ctx.strokeStyle = 'rgba(255,0,170,.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.strokeRect(px - 2, py - 2, w + 4, h + 4);
      ctx.setLineDash([]);
    }
  }

  _drawDeathAnim() {
    if (!this.state.dying) return;
    const ctx = this.ctx, p = this.state.player;
    const t = 1 - (this.state.deathTimer / DEATH_DUR);
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 + t * 4, dist = t * CS * 1.8;
      const cx = p.x + PLAYER_W / 2 + Math.cos(ang) * dist;
      const cy = p.y + PLAYER_H / 2 + Math.sin(ang) * dist;
      const sz = (1 - t) * 8;
      ctx.fillStyle = `rgba(255,50,64,${1 - t})`;
      ctx.fillRect(cx - sz / 2, cy - sz / 2, sz, sz);
    }
    ctx.save();
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = PAL.eye;
    ctx.beginPath();
    ctx.arc(p.x + PLAYER_W / 2, p.y + PLAYER_H / 2 - t * 30, 6 * (1 - t * 0.8), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _showMsg(txt) {
    const el = document.getElementById('h-msg');
    el.textContent = txt;
    el.classList.add('show');
    clearTimeout(this._msgTimer);
    this._msgTimer = setTimeout(() => el.classList.remove('show'), MSG_DUR * 1000);
  }

  _showOverlay(pre, title, sub, btnTxt, btnCb) {
    document.getElementById('ov-pre').textContent = pre;
    document.getElementById('ov-title').textContent = title;
    document.getElementById('ov-sub').textContent = sub;
    document.getElementById('ov-tip').style.display = 'none';
    const btn = document.getElementById('ov-start');
    btn.textContent = btnTxt;
    btn.onclick = btnCb;
    document.getElementById('overlay').classList.remove('off');
  }

  _hideOverlay() {
    document.getElementById('overlay').classList.add('off');
  }

  _togglePause() {
    if (!this.state.running) return;
    this.state.paused = !this.state.paused;
    if (this.state.paused) {
      this._showOverlay('PAUSED', '', '', 'RESUME', () => {
        this.state.paused = false;
        this._lastTS = performance.now();
        this._hideOverlay();
      });
    }
  }

  _bindInput() {
    document.addEventListener('keydown', e => {
      if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { this._togglePause(); return; }
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') this.keys.left = true;
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') this.keys.right = true;
if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        this.keys.jump = true;
      }
      e.preventDefault();
    }, { passive: false });
    document.addEventListener('keyup', e => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') this.keys.left = false;
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') this.keys.right = false;
      if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') this.keys.jump = false;
    });
  }

  _bindButtons() {
    this._bindBtn('btn-l', 'left');
    this._bindBtn('btn-r', 'right');
    this._bindBtn('btn-jump', 'jump');
  }

  _bindBtn(id, keyName) {
    const el = document.getElementById(id);
    if (!el) return;
    el.oncontextmenu = (e) => e.preventDefault();
    el.ontouchcancel = (e) => {
      this.keys[keyName] = false;
      this.keys.jumpJustPressed = false;
      el.classList.remove('pressed');
    };
    const doDown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.keys[keyName] = true;
      el.classList.add('pressed');
    };
    const doUp = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.keys[keyName] = false;
      el.classList.remove('pressed');
    };
    el.addEventListener('touchstart', doDown, { passive: false });
    el.addEventListener('touchend', doUp, { passive: false });
    el.addEventListener('touchcancel', doUp, { passive: false });
    el.addEventListener('mousedown', doDown);
    el.addEventListener('mouseup', doUp);
    el.addEventListener('mouseleave', doUp);
  }

  _bindUI() {
    document.getElementById('btn-pause').addEventListener('click', () => this._togglePause());
    const startOnce = () => { initAudio(); this.start(); };
    document.getElementById('ov-start').addEventListener('click', startOnce, { once: true });
    document.getElementById('ov-start').addEventListener('touchstart', e => {
      e.preventDefault();
      startOnce();
    }, { once: true, passive: false });
    window.addEventListener('resize', () => { if (this.state.running) this.resizeCanvas(); });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const game = new Game();
  game.init();
});