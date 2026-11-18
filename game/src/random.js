// A seeded generator (mulberry32): the same seed builds the same city and the same traffic, which
// is what lets a screenshot scene repeat itself frame for frame.

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
