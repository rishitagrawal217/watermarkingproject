export interface Gray { w: number; h: number; data: Uint8Array }
export const BLOCK = 8;

export const newGray = (w: number, h: number): Gray => ({ w, h, data: new Uint8Array(w * h) });
export const cloneGray = (g: Gray): Gray => ({ w: g.w, h: g.h, data: g.data.slice() });

/** round half to even, like numpy.rint */
export function rint(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}
export const clip8 = (x: number): number => (x < 0 ? 0 : x > 255 ? 255 : rint(x));

export function assertShape(g: Gray) {
  if (g.w % 16 || g.h % 16) throw new Error("image sides must be multiples of 16");
  if (g.data.length !== g.w * g.h) throw new Error("bad image buffer");
}
