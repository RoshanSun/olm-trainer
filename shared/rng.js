// Seeded RNG. Every roll in the simulator -- accuracy, damage, which special
// attack Olm picks -- goes through one of these so a drill can be replayed
// tile-for-tile from its seed. Math.random() is never called in shared/.

// mulberry32: small, fast, and good enough for a game sim. Not cryptographic.
export function makeRng(seed = Date.now()) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    seed,
    next,
    // Integer in [0, n). The engine rolls damage as "0 to max inclusive",
    // which is intRange(max + 1).
    intRange: (n) => Math.floor(next() * n),
    // True with probability p. Used for accuracy rolls.
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
}

// Turns a human-typed seed ("olm", "123") into the uint32 makeRng wants, so a
// shared drill seed can be a word rather than a number.
export function hashSeed(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
