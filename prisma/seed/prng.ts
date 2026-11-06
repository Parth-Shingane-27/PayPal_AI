/** Small deterministic PRNG (mulberry32) so every reseed produces the same data. */
export type Rng = {
  next(): number;
  int(min: number, max: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  weighted<T>(items: readonly T[], weight: (t: T) => number): T;
  shuffle<T>(items: readonly T[]): T[];
  /** Poisson-distributed count with mean `lambda` (Knuth; fine for small means). */
  poisson(lambda: number): number;
};

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new Error("pick from empty list");
      return items[Math.floor(next() * items.length)]!;
    },
    weighted: (items, weight) => {
      const total = items.reduce((s, i) => s + Math.max(0, weight(i)), 0);
      let r = next() * total;
      for (const i of items) {
        r -= Math.max(0, weight(i));
        if (r <= 0) return i;
      }
      return items[items.length - 1]!;
    },
    shuffle: (items) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
    poisson: (lambda) => {
      const l = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= next();
      } while (p > l);
      return k - 1;
    },
  };
  return rng;
}
