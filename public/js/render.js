// Canvas drawing. Everything is tiles -- the arena is a 13x12 grid and the
// renderer never thinks in pixels except at the very last step.
//
// Telegraphs are drawn with a countdown ring rather than just a colour, because
// the skill being trained is knowing how many ticks you have left, not noticing
// that something turned red.

import {
  GRID_W, GRID_H, HEAD, MAGE_HAND, MELEE_HAND, ZONE_BOUNDS, isWalkable,
} from '../shared/room.js';

const COLORS = {
  floor: '#171a24',
  floorAlt: '#141720',
  grid: '#232739',
  head: '#6b3f8f',
  headLit: '#9b5fc9',
  mage: '#3a5fa8',
  melee: '#a8453a',
  player: '#e9c547',
  path: 'rgba(233,197,71,0.25)',
  danger: 'rgba(224,75,75,0.38)',
  dangerEdge: '#e04b4b',
  acid: 'rgba(99,186,86,0.33)',
  bomb: 'rgba(232,163,61,0.26)',
  teleport: 'rgba(91,140,245,0.4)',
  zone: 'rgba(201,162,39,0.07)',
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tile = Math.floor(Math.min(canvas.width / GRID_W, canvas.height / GRID_H));
    this.ox = Math.floor((canvas.width - this.tile * GRID_W) / 2);
    this.oy = Math.floor((canvas.height - this.tile * GRID_H) / 2);
  }

  // Screen point -> tile. Used by the click handler.
  tileAt(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const scale = this.canvas.width / r.width;
    const x = Math.floor(((clientX - r.left) * scale - this.ox) / this.tile);
    const y = Math.floor(((clientY - r.top) * scale - this.oy) / this.tile);
    return { x, y };
  }

  px(x) { return this.ox + x * this.tile; }
  py(y) { return this.oy + y * this.tile; }

  draw(engine) {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.drawFloor(engine);
    this.drawZones(engine);
    this.drawParts(engine);
    this.drawHazards(engine);
    this.drawPath(engine);
    this.drawPlayer(engine);
  }

  drawFloor() {
    const { ctx, tile } = this;
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        if (!isWalkable(x, y)) continue;
        ctx.fillStyle = (x + y) % 2 ? COLORS.floor : COLORS.floorAlt;
        ctx.fillRect(this.px(x), this.py(y), tile, tile);
      }
    }
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    for (let x = 0; x <= GRID_W; x++) {
      ctx.beginPath();
      ctx.moveTo(this.px(x) + 0.5, this.py(0));
      ctx.lineTo(this.px(x) + 0.5, this.py(GRID_H));
      ctx.stroke();
    }
    for (let y = 0; y <= GRID_H; y++) {
      ctx.beginPath();
      ctx.moveTo(this.px(0), this.py(y) + 0.5);
      ctx.lineTo(this.px(GRID_W), this.py(y) + 0.5);
      ctx.stroke();
    }
  }

  // The zone Olm is facing is shaded -- standing outside it is what forces a
  // skip, so it has to be visible at a glance.
  drawZones(engine) {
    const { ctx, tile } = this;
    const facing = engine.olm.facing;
    const [lo, hi] = ZONE_BOUNDS[facing] ?? ZONE_BOUNDS.middle;
    ctx.fillStyle = COLORS.zone;
    ctx.fillRect(this.px(lo), this.py(0), (hi - lo + 1) * tile, GRID_H * tile);
    ctx.strokeStyle = 'rgba(201,162,39,0.35)';
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(this.px(lo) + 0.5, this.py(0) + 0.5, (hi - lo + 1) * tile - 1, GRID_H * tile - 1);
    ctx.setLineDash([]);
  }

  rect(r, fill, label, sub) {
    const { ctx, tile } = this;
    const x = this.px(r.x0);
    const y = this.py(r.y0);
    const w = (r.x1 - r.x0 + 1) * tile;
    const h = (r.y1 - r.y0 + 1) * tile;
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    if (label) {
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, x + w / 2, y + h / 2 + 3);
      if (sub) {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillText(sub, x + w / 2, y + h / 2 + 16);
      }
    }
  }

  drawParts(engine) {
    const o = engine.olm;
    this.rect(HEAD, o.isHeadPhase ? COLORS.headLit : COLORS.head, 'OLM',
      o.isHeadPhase ? `${o.headHp}` : null);

    const mage = o.mageHand;
    this.rect(MAGE_HAND, mage.down ? '#2a2f40' : COLORS.mage, 'MAGE',
      mage.down ? 'down' : `${mage.hp}`);

    const melee = o.meleeHand;
    this.rect(MELEE_HAND, melee.down ? '#2a2f40' : (melee.clenched ? '#8a6a2a' : COLORS.melee),
      'MELEE', melee.down ? 'down' : (melee.clenched ? 'clenched' : `${melee.hp}`));
  }

  drawHazards(engine) {
    const { ctx, tile } = this;
    for (const h of engine.hazards) {
      const ticksLeft = h.at - engine.tickCount;

      if (h.bomb) {
        const c = h.tiles[0];
        const r = 4;
        ctx.fillStyle = COLORS.bomb;
        ctx.fillRect(this.px(c.x - r + 1), this.py(c.y - r + 1), (2 * r - 1) * tile, (2 * r - 1) * tile);
        this.marker(c, '#e8a33d', ticksLeft);
        continue;
      }

      const fill = h.type === 'acid' ? COLORS.acid
        : h.type === 'teleport' ? COLORS.teleport
        : COLORS.danger;

      for (const t of h.tiles) {
        ctx.fillStyle = fill;
        ctx.fillRect(this.px(t.x), this.py(t.y), tile, tile);
      }

      if (h.type === 'teleport') {
        this.marker(h.tiles[0], '#5b8cf5', ticksLeft, 'STACK');
      } else if (h.tiles.length <= 3 && ticksLeft >= 0) {
        for (const t of h.tiles) this.marker(t, COLORS.dangerEdge, ticksLeft);
      } else if (ticksLeft >= 0 && h.tiles.length) {
        this.marker(h.tiles[0], COLORS.dangerEdge, ticksLeft);
      }
    }
  }

  // A tile marker with the tick countdown in it -- the countdown is the point.
  marker(t, color, ticksLeft, text) {
    const { ctx, tile } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(this.px(t.x) + 1.5, this.py(t.y) + 1.5, tile - 3, tile - 3);
    ctx.lineWidth = 1;
    if (ticksLeft >= 0) {
      ctx.fillStyle = color;
      ctx.font = '600 13px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(text ?? String(ticksLeft), this.px(t.x) + tile / 2, this.py(t.y) + tile / 2 + 5);
    }
  }

  drawPath(engine) {
    const { ctx, tile } = this;
    ctx.fillStyle = COLORS.path;
    for (const t of engine.player.path) {
      ctx.fillRect(this.px(t.x) + tile * 0.35, this.py(t.y) + tile * 0.35, tile * 0.3, tile * 0.3);
    }
  }

  drawPlayer(engine) {
    const { ctx, tile } = this;
    const p = engine.player;
    const cx = this.px(p.x) + tile / 2;
    const cy = this.py(p.y) + tile / 2;

    ctx.fillStyle = COLORS.player;
    ctx.beginPath();
    ctx.arc(cx, cy, tile * 0.3, 0, Math.PI * 2);
    ctx.fill();

    if (p.frozenTicks > 0) {
      ctx.strokeStyle = '#5b8cf5';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, tile * 0.42, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    // The overhead rides on the player so you can see what you actually have
    // up without looking away from the arena.
    if (p.overhead) {
      const tint = { magic: '#5b8cf5', missiles: '#4caf78', melee: '#d0574b' }[p.overhead];
      ctx.fillStyle = tint;
      ctx.beginPath();
      ctx.arc(cx, cy - tile * 0.42, tile * 0.14, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
