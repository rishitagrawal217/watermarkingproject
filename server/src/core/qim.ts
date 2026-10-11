/** Quantisation index modulation: bit 0 -> lattice k*delta, bit 1 -> k*delta + delta/2. */
export function qimEmbed(c: number, bit: number, delta: number): number {
  const off = bit * delta / 2;
  return Math.round((c - off) / delta) * delta + off;
}
export function qimDist(c: number, delta: number): [number, number] {
  const d0 = Math.abs(c - Math.round(c / delta) * delta);
  const c1 = c - delta / 2;
  const d1 = Math.abs(c1 - Math.round(c1 / delta) * delta);
  return [d0, d1];
}
/** Blind decision over a group of coefficients: bit with the smaller summed lattice distance. */
export function qimDecide(cs: ArrayLike<number>, delta: number): number {
  let s0 = 0, s1 = 0;
  for (let i = 0; i < cs.length; i++) { const [a, b] = qimDist(cs[i], delta); s0 += a; s1 += b; }
  return s1 < s0 ? 1 : 0;
}
