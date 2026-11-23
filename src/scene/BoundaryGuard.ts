export const DEFAULT_ARENA_RADIUS = 9.0;
export const DEFAULT_MAX_OBJECTS = 60;

export class BoundaryGuard {
  readonly arenaRadius: number;
  readonly maxObjects: number;

  constructor(
    arenaRadius = DEFAULT_ARENA_RADIUS,
    maxObjects = DEFAULT_MAX_OBJECTS,
  ) {
    this.arenaRadius = arenaRadius;
    this.maxObjects = maxObjects;
  }

  clampPosition(
    pos: [number, number, number],
    boundingRadius = 0.75,
    scale = 1.0,
  ): [number, number, number] {
    const safeReach = Math.max(1.5, this.arenaRadius - boundingRadius * scale);
    let x = Number.isFinite(pos[0]) ? pos[0] : 0;
    let y = Number.isFinite(pos[1]) ? pos[1] : 0;
    let z = Number.isFinite(pos[2]) ? pos[2] : 0;

    y = Math.max(0, Math.min(4, y));

    const distSq = x * x + z * z;
    if (distSq > safeReach * safeReach) {
      const dist = Math.sqrt(distSq);
      const factor = safeReach / dist;
      x *= factor;
      z *= factor;
    }

    return [Number(x.toFixed(2)), Number(y.toFixed(2)), Number(z.toFixed(2))];
  }

  clampScale(scale: number): number {
    if (!Number.isFinite(scale)) return 1.0;
    return Number(Math.max(0.25, Math.min(3.0, scale)).toFixed(2));
  }

  normalizeRotationY(rotationY: number): number {
    if (!Number.isFinite(rotationY)) return 0;
    const twoPi = Math.PI * 2;
    let wrapped = ((rotationY + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
    if (Math.abs(wrapped + Math.PI) < 0.0001) wrapped = Math.PI;
    return Number(wrapped.toFixed(4));
  }

  canAdd(currentCount: number): boolean {
    return currentCount < this.maxObjects;
  }
}
