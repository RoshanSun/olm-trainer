// Olm itself: phases, the rotation, the hands, the head.
//
// The thing a player is really learning here is that Olm is on rails. It runs a
// fixed 12-step cycle and acts every 4 ticks, so a Crystal Burst is never a
// surprise -- it is step 3, and you can count to it. The simulator models the
// cycle as a cycle rather than as random events, because any model that rolls
// dice for "which special now" would teach reaction instead of anticipation.

import {
  POWERS, PHASE_KIND, phaseCount, BASE_HP, scaleHp, ROTATION, OLM_ATTACK_SPEED,
  STYLE_SWAP_CHANCE, AUTO_MAX_HIT, POWER_ATTACK_CHANCE, GENERIC_SPECIALS,
  CLENCH_DAMAGE_WINDOW, CLENCH_DAMAGE_FRACTION, CLENCH_DURATION,
  HAND_REGEN_DURATION, HEAD_AUTOHEAL_DELAY, HAND_HIT_TURN_WINDOW,
  LEFT_HAND_HEAL_DELAY_ATTACKS, LEFT_HAND_HEAL_DURATION_ATTACKS,
  WEAKNESS, OFF_STYLE_MULTIPLIER, TRANSITION,
} from './olm-data.js';
import { zoneOf } from './room.js';

export class Hand {
  constructor(key, maxHp) {
    this.key = key;              // 'mageHand' | 'meleeHand'
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.clenched = false;
    this.clenchTicks = 0;
    this.down = false;           // at 0 hp
    this.regenTicks = 0;         // penultimate-phase comeback timer
    this.healing = false;        // left hand's infinity state
    this.healAttacks = 0;
    this.recentDamage = [];      // [tick, amount] inside the clench window
  }

  get alive() {
    return !this.down;
  }

  // Returns the damage actually applied, after the off-style cut and the
  // left hand's heal state.
  takeDamage(amount, style, tick) {
    if (this.down || this.clenched) return 0;
    let dealt = Math.floor(amount * (style === WEAKNESS[this.key] ? 1 : OFF_STYLE_MULTIPLIER));
    if (this.healing) {
      this.hp = Math.min(this.maxHp, this.hp + dealt);
      return -dealt;
    }
    dealt = Math.min(dealt, this.hp);
    this.hp -= dealt;

    this.recentDamage.push([tick, dealt]);
    this.recentDamage = this.recentDamage.filter(([t]) => tick - t < CLENCH_DAMAGE_WINDOW);

    if (this.hp <= 0) {
      this.down = true;
      this.hp = 0;
      this.regenTicks = HAND_REGEN_DURATION;
    }
    return dealt;
  }

  // The melee hand clenches when a single window of damage crosses 5% of its
  // max HP. Killing the mage hand first switches this off for the rest of the
  // phase, which is exactly why that is the standard opening.
  checkClench(mageHandDown) {
    if (this.key !== 'meleeHand' || this.down || this.clenched) return false;
    if (mageHandDown) return false;
    const inWindow = this.recentDamage.reduce((sum, [, d]) => sum + d, 0);
    if (inWindow >= this.maxHp * CLENCH_DAMAGE_FRACTION) {
      this.clenched = true;
      this.clenchTicks = CLENCH_DURATION;
      this.recentDamage = [];
      return true;
    }
    return false;
  }

  tick() {
    if (this.clenched) {
      this.clenchTicks -= 1;
      if (this.clenchTicks <= 0) this.clenched = false;
    }
    if (this.down && this.regenTicks > 0) this.regenTicks -= 1;
  }

  // Penultimate phase only: a downed hand that is left alone comes all the way
  // back, so both have to drop inside the same window.
  tryRegen() {
    if (this.down && this.regenTicks <= 0) {
      this.down = false;
      this.hp = this.maxHp;
      this.regenTicks = 0;
      return true;
    }
    return false;
  }
}

export class Olm {
  constructor({ players = 1, challengeMode = false, rng }) {
    this.rng = rng;
    this.players = players;
    this.challengeMode = challengeMode;
    this.totalPhases = phaseCount(players);

    this.phase = 1;
    this.step = 0;               // index into ROTATION
    this.cooldown = 0;           // ticks until the next action
    this.style = 'magic';        // current auto-attack style
    this.facing = 'middle';
    this.attackCount = 0;

    this.transitioning = false;
    this.transitionCrystalsLeft = 0;
    this.dead = false;

    // Powers are dealt out so each is used once before any repeats.
    this.powerBag = this.rng ? shuffle(POWERS, this.rng) : [...POWERS];
    this.power = this.powerBag[0];
    this.usedPowerAttacks = new Set();

    this.headMaxHp = scaleHp(BASE_HP.head, players);
    this.headHp = this.headMaxHp;
    this.headDamagePending = [];   // [tickToHeal, amount] outside the head phase
    this.lastHandHitTick = { mageHand: -99, meleeHand: -99 };

    this.resetHands();
  }

  resetHands() {
    this.mageHand = new Hand('mageHand', scaleHp(BASE_HP.rightHand, this.players));
    this.meleeHand = new Hand('meleeHand', scaleHp(BASE_HP.leftHand, this.players));
  }

  get kind() {
    if (this.phase >= this.totalPhases) return PHASE_KIND.HEAD;
    if (this.phase === this.totalPhases - 1) return PHASE_KIND.PENULTIMATE;
    return PHASE_KIND.POWER;
  }

  get isHeadPhase() {
    return this.kind === PHASE_KIND.HEAD;
  }

  get maxHit() {
    const table = this.challengeMode ? AUTO_MAX_HIT.challenge : AUTO_MAX_HIT.normal;
    return table[Math.min(this.phase, table.length) - 1];
  }

  // --- Damage in ------------------------------------------------------------

  damageHead(amount, style, tick) {
    const dealt = Math.floor(amount * (style === WEAKNESS.head ? 1 : OFF_STYLE_MULTIPLIER));
    const applied = Math.min(dealt, this.headHp);
    this.headHp -= applied;

    // Outside the head phase the head simply heals it all back a few ticks
    // later, so chipping it is wasted DPS rather than progress.
    if (!this.isHeadPhase) {
      this.headDamagePending.push([tick + HEAD_AUTOHEAL_DELAY, applied]);
    } else if (this.headHp <= 0) {
      this.headHp = 0;
      this.dead = true;
    }
    return applied;
  }

  damageHand(key, amount, style, tick) {
    const hand = this[key];
    const dealt = hand.takeDamage(amount, style, tick);
    if (dealt !== 0) this.lastHandHitTick[key] = tick;
    hand.checkClench(this.mageHand.down);
    return dealt;
  }

  // Olm heals from Life Siphon, at five times what it dealt.
  heal(amount) {
    this.headHp = Math.min(this.headMaxHp, this.headHp + amount);
  }

  // --- Head facing ----------------------------------------------------------
  //
  // In a solo the player is always standing in one of the three zones, so the
  // "skip" rule becomes the safespot game: stand outside the zone Olm is
  // facing and it turns, loses the attack, and -- because specials never catch
  // up -- can lose a Crystal Burst outright.

  updateFacing(playerPos, tick) {
    const want = zoneOf(playerPos.x);

    // A hand hit inside the window pulls the head toward that hand.
    for (const [key, side] of [['mageHand', 'left'], ['meleeHand', 'right']]) {
      if (tick - this.lastHandHitTick[key] <= HAND_HIT_TURN_WINDOW && this.facing !== want) {
        this.facing = side;
        return { turned: true, skipped: true };
      }
    }

    if (this.facing !== want) {
      this.facing = want;
      return { turned: true, skipped: true };
    }
    return { turned: false, skipped: false };
  }

  // --- The rotation ---------------------------------------------------------

  // Advances one tick. Returns the action for this tick, or null if Olm is
  // between actions.
  tick(tick, playerPos) {
    this.mageHand.tick();
    this.meleeHand.tick();

    // Resolve the head's pending self-heals.
    this.headDamagePending = this.headDamagePending.filter(([at, amount]) => {
      if (tick >= at) {
        this.headHp = Math.min(this.headMaxHp, this.headHp + amount);
        return false;
      }
      return true;
    });

    if (this.kind === PHASE_KIND.PENULTIMATE) {
      // Let a lone downed hand come back if the other is still up.
      if (this.mageHand.down && !this.meleeHand.down) this.mageHand.tryRegen();
      if (this.meleeHand.down && !this.mageHand.down) this.meleeHand.tryRegen();
    }

    if (this.transitioning) return this.tickTransition(tick);

    if (!this.isHeadPhase && this.mageHand.down && this.meleeHand.down) {
      this.beginTransition();
      return { type: 'phase-end' };
    }

    this.cooldown -= 1;
    if (this.cooldown > 0) return null;
    this.cooldown = OLM_ATTACK_SPEED;

    const slot = ROTATION[this.step];
    this.step = (this.step + 1) % ROTATION.length;

    if (slot === 'empty') return { type: 'empty' };

    if (GENERIC_SPECIALS.includes(slot)) {
      // Generic specials vanish in the head phase, and a clenched hand cannot
      // telegraph them.
      if (this.isHeadPhase || this.meleeHand.clenched) return { type: 'empty' };
      return { type: 'special', attack: slot };
    }

    return this.standardAttack(tick, playerPos);
  }

  standardAttack(tick, playerPos) {
    const look = this.updateFacing(playerPos, tick);
    if (look.skipped) {
      // The lost attack is made up on the very next step -- once, never
      // cascading, and never for a special.
      this.pendingCatchUp = true;
      return { type: 'skipped', facing: this.facing };
    }

    this.attackCount += 1;

    // The left hand's heal window opens two attacks after a teleport.
    if (this.kind === PHASE_KIND.PENULTIMATE) this.updateHealState();

    const powerChance = this.isHeadPhase
      ? POWER_ATTACK_CHANCE.head
      : POWER_ATTACK_CHANCE.normal;

    if (this.rng.next() < powerChance) {
      const attack = this.pickPowerAttack();
      if (attack) return { type: 'power', attack, power: this.activePower() };
    }

    if (this.rng.next() < STYLE_SWAP_CHANCE) {
      this.style = this.style === 'magic' ? 'ranged' : 'magic';
    }
    return { type: 'auto', style: this.style, maxHit: this.maxHit, facing: this.facing };
  }

  // The head phase has every power available, not just the phase's own.
  activePower() {
    if (this.isHeadPhase || this.kind === PHASE_KIND.PENULTIMATE) {
      return this.rng.pick(POWERS);
    }
    return this.power;
  }

  pickPowerAttack() {
    const power = this.activePower();
    const options = POWER_ATTACKS[power];
    // Olm tries, but is not guaranteed, to avoid repeating itself in a phase.
    const fresh = options.filter((a) => !this.usedPowerAttacks.has(a));
    const pool = fresh.length ? fresh : options;
    const attack = this.rng.pick(pool);
    this.usedPowerAttacks.add(attack);
    return attack;
  }

  updateHealState() {
    const hand = this.meleeHand;
    if (hand.healAttacks > 0) {
      hand.healAttacks -= 1;
      hand.healing = hand.healAttacks > 0;
    }
  }

  onTeleport() {
    // Arms the left hand's heal state for two attacks, two attacks from now.
    if (this.kind !== PHASE_KIND.PENULTIMATE) return;
    this.pendingHealArm = LEFT_HAND_HEAL_DELAY_ATTACKS;
    this.meleeHand.healAttacks = LEFT_HAND_HEAL_DELAY_ATTACKS + LEFT_HAND_HEAL_DURATION_ATTACKS;
    this.meleeHand.healing = false;
  }

  // --- Phase transitions ----------------------------------------------------

  beginTransition() {
    this.transitioning = true;
    const [lo, hi] = TRANSITION.crystalCount;
    this.transitionCrystalsLeft = lo + this.rng.intRange(hi - lo + 1);
    this.transitionCooldown = TRANSITION.crystalIntervalTicks;
  }

  tickTransition() {
    this.transitionCooldown -= 1;
    if (this.transitionCooldown > 0) return null;
    this.transitionCooldown = TRANSITION.crystalIntervalTicks;
    this.transitionCrystalsLeft -= 1;

    if (this.transitionCrystalsLeft <= 0) {
      this.endTransition();
      return { type: 'phase-start', phase: this.phase, power: this.power };
    }
    return { type: 'transition-crystal' };
  }

  endTransition() {
    this.transitioning = false;
    this.phase += 1;
    this.step = 0;
    this.cooldown = OLM_ATTACK_SPEED;
    this.usedPowerAttacks.clear();
    this.power = this.powerBag[(this.phase - 1) % this.powerBag.length];
    if (!this.isHeadPhase) this.resetHands();
  }
}

export const POWER_ATTACKS = {
  acid: ['acid-spray', 'acid-drip'],
  flame: ['deep-burn', 'fire-wall'],
  crystal: ['falling-crystals', 'crystal-bomb'],
};

function shuffle(arr, rng) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.intRange(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
