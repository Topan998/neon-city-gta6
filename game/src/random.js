// Seeded randomness. Every system that has to look the same on every load draws from one of these
// generators instead of Math.random: the city layout, the pavement texture, the crowd's colours,
// the traffic, and now the combat effects and the police spawn ring. Two page loads therefore build
// two identical cities, which is what lets the four screenshots be compared with `cmp`.
//
// `hashUnit` is the stateless cousin: a pure function of (salt, index) in [0, 1), used where a
// per-entity decision must be repeatable without carrying a generator around (a pedestrian's pause
// at a corner, a lamp's flicker offset).

export function createRandom(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A number in [min, max) from a generator. */
export function range(random, min, max) {
  return min + random() * (max - min);
}

/** An integer in [min, max] from a generator. */
export function int(random, min, max) {
  return Math.floor(min + random() * (max - min + 1));
}

/** One entry of an array, chosen by a generator. */
export function pick(random, list) {
  return list[Math.floor(random() * list.length) % list.length];
}

/**
 * A stable value in [0, 1) from two integers. Same inputs, same output, on every browser and every
 * reload — the cheap way to give thousands of instanced things their own repeatable variation.
 */
export function hashUnit(salt, index) {
  let h = Math.imul((salt | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(index | 0, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
