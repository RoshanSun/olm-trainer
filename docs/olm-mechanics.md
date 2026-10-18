# Great Olm — mechanical reference

Researched from the OSRS Wiki (fetched 2026-10-17):

- https://oldschool.runescape.wiki/w/Great_Olm
- https://oldschool.runescape.wiki/w/Chambers_of_Xeric/Strategies
- https://oldschool.runescape.wiki/w/Chambers_of_Xeric/Challenge_Mode

Note: `Great_Olm/Strategies` is not a real page; Olm strategy lives in `Chambers of Xeric/Strategies`.

Game tick = 0.6s. Items marked **UNCERTAIN** are not numerically pinned by the wiki; the
simulator picks a plausible value and keeps it in one named constant so it is easy to retune.

## 1. Phase structure

`phases = 4 + floor(players / 8)` → solo is **4 phases**: 3 "power" phases + the head phase.

Each non-head phase is assigned exactly one power at phase start, announced in chat
("The Great Olm rises with the power of X!"): **Acid**, **Flame**, or **Crystal**. The power
never changes mid-phase. With extra phases (large parties) a power repeats only after all
three have been used once.

- **Phases 1-2**: one power plus the generic specials (Crystal Burst / Lightning / Teleport).
- **Penultimate phase** (phase 3 solo): head glows green, *all three* powers are available,
  both hands must go down inside the same regen window, and the left hand gains a
  heal-from-damage state (infinity icon) for 2 attacks, beginning 2 attacks after a Teleport.
- **Head phase** (phase 4 solo): hands are gone for good, head auto-heal is removed,
  Crystal Burst / Lightning / Teleport are removed, falling crystals become continuous, and
  **Life Siphon** appears. Ends at head HP 0.

Progression gate: both hands disabled. In the head phase, the head itself must be dropped.

There is **no documented time-based enrage**. The head phase is simply the head fight with
auto-heal off and crystals falling. The only escalation is the max-hit bump (see §3).

## 2. Hitpoints and healing

Solo max-combat baseline:

| Part | HP | Weak to | Mitigation |
|---|---|---|---|
| Head | 800 | Ranged | 66% reduction vs non-Ranged |
| Left claw (melee hand) | 600 | Melee | 66% reduction vs non-Melee |
| Right claw (mage hand) | 600 | Magic | 66% reduction vs non-Magic |

All three take **+50% from Earth spells** (25 June 2025 patch).

**Challenge Mode does not raise Olm's HP** — unique among CoX monsters. CM raises its
combat stats (accuracy / max hit) only.

Party-size HP scaling: **UNCERTAIN**. The wiki says only that stats scale off the single
highest-combat player in the party. No formula is published; 800/600/600 solo is the one
concrete anchor.

Combat stats reset to base at the start of every phase, so drains (DWH/BGS) do not carry over.

### Head auto-heal

Outside the head phase, damage to the head is fully healed back "shortly afterwards"
(**UNCERTAIN** tick delay). The head is therefore not gated by an immunity — it is gated by
the heal. In the head phase the heal is removed and damage is permanent.

### Hand clenching

- **Trigger**: the left hand clenches on a hit of **≥ 5% of its max HP (1/20) inside an
  8-tick window** (Mod Ash, via wiki footnote).
- **While clenched**: invulnerable ~30s (**~50 ticks, UNCERTAIN**), and Olm cannot use its
  *generic* specials. Power-specific attacks continue.
- The clench mechanic stops for the rest of the phase once the **mage hand** is fully
  disabled — which is exactly why the standard strategy kills the mage hand first.

### Penultimate-phase hand regen

A hand dropped to 0 shows a recovery bar. If it fills (~30s, **UNCERTAIN ticks**) before the
other hand is also down, it **returns at full HP** and further damage scores no points. Usual
line: bring both to ~75 HP, finish the melee hand first (its heal state otherwise wastes
time), then the mage hand.

## 3. Auto-attacks

| Stat | Value |
|---|---|
| Styles | Magic (green dragonfire bolt) and Ranged (crystal chunk) — identical damage |
| Speed | **4 ticks (2.4s)** |
| Max hit, normal solo | 27 (phases 1-2) → 28 → **29 (head phase)** |
| Max hit, Challenge Mode solo | 38 → 39 → **41** |
| Protection prayer | Reduces basic auto damage by **~75-80%** |
| Style switch | **1/5 (20%)** chance to swap style on every head attack |

### Head look

The head faces one of **three zones: left, middle, right**, and only attacks players in the
zone it faces. It prefers the zone holding the most players; if its current zone is empty it
turns toward the best zone and **skips that attack**. If the right (mage) hand takes damage
within **4 ticks** and Olm is not already looking at a player, it turns right — mirrored for
the left hand. Thrall and burn damage both count.

### Rotation — 12-step repeating cycle

```
 1  empty event
 2  standard attack
 3  CRYSTAL BURST      (special)
 4  standard attack
 5  empty event
 6  standard attack
 7  LIGHTNING          (special)
 8  standard attack
 9  empty event
10  standard attack
11  TELEPORT / SWAP    (special)
12  standard attack
    -> loop
```

"Standard attack" = a basic magic/ranged auto, a sphere, or a power-specific attack. Each
standard slot has a **1/3 chance** (**1/2 in the head phase**) of being a power-specific
attack instead, off cooldown; Olm tries, but is not guaranteed, to avoid repeating a power
attack already used this phase.

**Catch-up**: a standard attack skipped for an empty zone is performed on the *next* step in
addition to that step's action — so a standard and a special can land on the same tick.
Catch-up reaches back exactly one step and never cascades. **Specials are never caught up**,
so a well-timed skip can make Olm permanently lose a Burst/Lightning/Teleport for that cycle.

### Spheres (a kind of standard attack)

| Sphere | Type | Blocked by |
|---|---|---|
| Red | Aggression (melee) | Protect from Melee |
| Green | Dexterity (ranged) | Protect from Missiles |
| Purple | Magical power | Protect from Magic |

Unblocked, a sphere hits for **~50% of current HP**. If the right prayer was up at launch but
the player switches it off before impact, the prayer is disabled and prayer points are halved.

## 4. Special attacks

### 4a. Power-specific (replace a standard-attack slot)

| Attack | Power | Damage | Avoidance |
|---|---|---|---|
| **Acid Spray** | Acid | 3-6/tick on a pool, plus poison starting at 2 | Step off the pool |
| **Acid Drip** | Acid | as Spray; moving lays more pools | Stand still, then relocate |
| **Deep Burn** | Flame | 5 dmg and -2 to all combat stats, **6 times** ("Burn with me!"); spreads to adjacent unburned players and resets | Spread out; inter-hit interval **UNCERTAIN** |
| **Fire Wall** | Flame | up to **10** on spawn, then **50-65 over ~5s (~8 ticks, UNCERTAIN)** if trapped | Dash the gap, or douse a segment with a water/ice spell, Humidify, or a filled watering can |
| **Falling Crystals** | Crystal | **11 crystals**, 1×1 AoE, **15-20** (main page) / 16-20 (strategies) per hit | Move off the marked tile |
| **Crystal Bombs** | Crystal | up to 3 (2 in small groups); 4-tile radius, rim **15**, +15 per tile inward, **60** on the tile | Get to the rim or clear out |

### 4b. Generic specials (fixed cycle slots; absent in the head phase)

| Attack | Slot | Damage | Avoidance |
|---|---|---|---|
| **Crystal Burst** | 3 | seedling under every player, bursts a few ticks later (**UNCERTAIN**): heavy damage + knockback | Step off the seedling |
| **Lightning** | 7 | bolts run N and/or S through the chamber; "moderate" damage, **disables overheads**, binds for a few seconds | Stand off the affected row/column |
| **Teleport / Swap** | 11 | **0** on the target tile, **5** adjacent, **10** at 2 tiles, scaling to **50** at max distance | Stack the target tile immediately |

Solo teleport picks a random tile up to **10 tiles** away from the player at cast time. In
groups it targets up to 6 players evenly; with an odd count the leftover player is excluded.

The left hand telegraphs each generic special with an icon: crystal, lightning, or swirl.

### 4c. Head phase only

| Attack | Behaviour |
|---|---|
| **Falling Crystals (continuous)** | 3×3 AoE, shadow telegraph. Direct **16-25** (main) / 20-25 (strategies); one tile off-centre **10-16** (main) / 12-16 (strategies). One crystal always tracks a random player. |
| **Life Siphon** | Two blue projectiles mark two tiles; players have **6s (~10 ticks)** to stand on one. Anyone off a marked tile takes up to **18**, and **Olm heals 5× the total damage dealt**. |

No head-phase-exclusive "headbutt" is documented. Crystal bombs are a Crystal-power attack,
available in the head phase only because all powers are.

### Phase transitions

Olm retreats underground and crystals fall with shadow telegraphs (same 3×3 mechanic,
20-25 direct / 12-16 indirect). The transition ends after **7-8 targeting crystals have
landed** — a count trigger, not a fixed duration. Inter-crystal spacing is **UNCERTAIN**.

## 5. Timing summary

| Parameter | Value |
|---|---|
| Game tick | 0.6s |
| Olm attack speed | 4 ticks |
| Style swap chance | 1/5 per attack |
| Power-attack substitution | 1/3 normal, 1/2 head phase |
| Clench damage window | 8 ticks, threshold ≥ 5% of hand max HP |
| Clench invulnerability | ~30s (**~50 ticks, UNCERTAIN**) |
| Penultimate hand regen | ~30s (**~50 ticks, UNCERTAIN**) |
| Life Siphon window | 6s (~10 ticks) |
| Fire Wall escape window | ~5s (~8 ticks) |
| Transition crystals | 7-8 landings |
| Solo clear benchmark | ~10 min, a supply-budget guideline, not an enrage |

## Open / uncertain

- HP scaling vs party size and raid level (only 800/600/600 solo is confirmed).
- Head auto-heal delay outside the head phase.
- Clench invulnerability and penultimate regen durations in exact ticks.
- Telegraph-to-detonation ticks for Crystal Burst, Crystal Bombs, and Deep Burn's interval.
- Inter-wave spacing of transition crystals.
- Any formal enrage state — not wiki-documented.
- Falling-crystal damage differs between the two wiki pages by about ±5; treat as a band.
