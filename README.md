# Olm Trainer

A tick-accurate, single-player practice simulator for the **Great Olm**, the final boss of
the Chambers of Xeric raid in Old School RuneScape.

Olm is not a reaction test. It runs a fixed twelve-step rotation and acts every four ticks,
which means a Crystal Burst is never a surprise — it is step 3, and you can count to it. This
trainer exists to build that count, plus the prayer switching, positioning and supply cycling
that go with it, without spending an hour of raid time per attempt.

```
npm start           # http://localhost:8080
npm test            # 63 tests
npm run build       # static build in dist/ for GitHub Pages
```

No dependencies. Node 18+.

## Drills

| Drill | What it practises |
|---|---|
| **Full solo kill** | The whole four-phase fight, from first hand to the head. |
| **Head phase only** | The hardest phase, on repeat, without re-clearing three phases first. |
| **Prayer only** | Olm's attack cycle with the DPS race removed — just the overheads. |
| **Crystal burst only** | Step-off timing, in isolation. |

Every run is seeded. Type a seed and the fight replays tile-for-tile, so a death can be
retried as the exact same fight rather than a new one.

## Controls

| Input | Action |
|---|---|
| Click a tile | Move there (real OSRS pathing, 2 tiles/tick running) |
| `Q` / `W` / `E` | Protect from Magic / Missiles / Melee |
| `A` / `S` / `D` | Target mage hand / melee hand / head |
| `1` / `2` | Saradomin brew / Super restore |
| `R` | Toggle run |
| `Space` | Pause |

## What is actually simulated

- **The 0.6s tick**, with prayers resolved against a start-of-tick snapshot. An overhead
  toggled during a tick does not protect against that tick's hit, which is the single rule
  that makes prayer practice meaningful.
- **The twelve-step rotation**: Crystal Burst on step 3, Lightning on 7, Teleport on 11,
  four ticks apart, with empty steps in between.
- **The skip rule.** Olm only attacks the zone it faces. Stand outside it and the head turns
  and loses the attack — and because specials never catch up, a well-timed skip can delete a
  Crystal Burst outright. The faced zone is shaded in the arena.
- **Hand clenching**: a hit over 5% of the melee hand's max HP inside an 8-tick window
  clenches it. Killing the mage hand first turns the mechanic off for the rest of the phase,
  which is why that is the standard opening.
- **The penultimate phase regen race.** Drop one hand and leave the other up, and the first
  comes back at full health. Both have to go down inside the same window.
- **Head auto-heal.** Outside the head phase the head heals back whatever you chip off it,
  so attacking it early is wasted DPS rather than progress.
- **Real combat maths** — effective levels, max hits and accuracy rolls follow the wiki's
  floor order, including the two places magic deliberately differs from melee and ranged.
- **Supplies.** Brews, restores, prayer drain, and the stat drain that makes over-brewing
  cost you damage.

### Two things the trainer will tell you that you may not expect

**The Twisted bow is bad here.** It scales off the target's magic level, and Olm's is 60,
which lands the accuracy term at about 74% — a penalty. Pick the `tbow-solo` loadout and
compare it against `max-solo` to see it.

**Protection prayers do not fully block Olm.** The correct overhead cuts a basic auto by
roughly 78%, not 100%. The chip damage is real and is why solos burn through brews.

## Layout

```
shared/     the whole simulation, headless and deterministic
  rng.js        seeded RNG -- nothing calls Math.random
  olm-data.js   every constant, with UNCERTAIN values isolated as named knobs
  room.js       13x12 grid, zones, OSRS pathing, run energy
  combat.js     effective levels, max hits, accuracy, specs, twisted bow
  gear.js       weapon and loadout presets, Olm's defensive stats
  olm.js        phases, rotation, hands, head
  engine.js     the tick loop
public/     canvas renderer and input
server/     static file server (no game state lives here)
test/       63 tests
docs/       the sourced mechanical reference
```

`shared/` runs identically in Node and the browser, which is why the tests can play whole
fights headlessly.

## Accuracy and its limits

Mechanics are researched from the [OSRS Wiki](https://oldschool.runescape.wiki/w/Great_Olm);
the full sourced reference with URLs is in [`docs/olm-mechanics.md`](docs/olm-mechanics.md).

Some things Jagex has never published, and the wiki says "a few seconds" where a simulator
needs a tick count. Those values are marked `UNCERTAIN` in `shared/olm-data.js` and kept as
named constants so they can be retuned in one place:

- Exact telegraph-to-detonation ticks for Crystal Burst, Crystal Bombs and Deep Burn.
- Clench invulnerability and penultimate regen durations (the wiki gives "~30 seconds").
- Head auto-heal delay.
- Olm's per-part defence level — not published anywhere, so it is tuned to give realistic
  solo kill times. **This is the first knob to turn** if kills feel too fast or too slow.
- Party-size HP scaling. Solo is exact (800 head, 600 per hand); larger parties are a
  plausible placeholder.

The room geometry is a reconstruction, not a map. Olm's chamber is instanced and procedurally
placed, so no official tile grid exists; the layout here comes from RuneLite ground-marker
exports that players use live — the two hand columns nine tiles apart, with a twelve-tile
attack band. What matters for practice is that the distances, zones and per-tick movement are
right, and those are.
