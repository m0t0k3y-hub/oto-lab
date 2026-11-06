export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
