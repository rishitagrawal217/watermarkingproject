/** Orthonormal 8x8 DCT-II (same transform as scipy.fft.dctn norm="ortho"). */
export const C = new Float64Array(64);
for (let k = 0; k < 8; k++)
  for (let n = 0; n < 8; n++) C[k * 8 + n] = (k === 0 ? Math.sqrt(1 / 8) : Math.sqrt(2 / 8)) * Math.cos((Math.PI * (2 * n + 1) * k) / 16);

const tmp = new Float64Array(64);

/** coef[u][v] = sum_n sum_m C[u][n] x[n][m] C[v][m]   (u: vertical freq, v: horizontal freq) */
export function dct2(x: Float64Array, out: Float64Array): void {
  for (let u = 0; u < 8; u++)
    for (let m = 0; m < 8; m++) {
      let s = 0;
      for (let n = 0; n < 8; n++) s += C[u * 8 + n] * x[n * 8 + m];
      tmp[u * 8 + m] = s;
    }
  for (let u = 0; u < 8; u++)
    for (let v = 0; v < 8; v++) {
      let s = 0;
      for (let m = 0; m < 8; m++) s += tmp[u * 8 + m] * C[v * 8 + m];
      out[u * 8 + v] = s;
    }
}

/** Add `d * basis(u,v)` to out (spatial 8x8); used to push coefficient deltas back to pixels. */
export function addBasis(out: Float64Array, u: number, v: number, d: number): void {
  for (let n = 0; n < 8; n++) {
    const a = C[u * 8 + n] * d;
    for (let m = 0; m < 8; m++) out[n * 8 + m] += a * C[v * 8 + m];
  }
}
