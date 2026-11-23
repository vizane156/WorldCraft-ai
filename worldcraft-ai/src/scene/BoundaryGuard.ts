/**
 * BoundaryGuard — pure transform clamping rules.
 *
 * No Three.js, no IWSDK, no networking.
 */

import type { Vec3, Transform } from '../interaction/InteractionAdapter';

export const DEFAULT_SCENE_RADIUS_M = 0.5;
export const DEFAULT_MAX_OBJECTS = 20;
export const DEFAULT_Y_MIN = 0;
export const DEFAULT_Y_MAX = 0.35;

export class BoundaryGuard {
  /**
   * Clamp a position to a cylinder of `radiusM` around the scene origin (XZ plane),
   * and keep Y grounded within [yMin, yMax].
   */
  clampPosition(
    pos: Vec3,
    radiusM = DEFAULT_SCENE_RADIUS_M,
    yMin = DEFAULT_Y_MIN,
    yMax = DEFAULT_Y_MAX,
  ): Vec3 {
    const [x, y, z] = pos;
    const clampedY = Math.max(yMin, Math.min(yMax, Number.isFinite(y) ? y : 0));
    const safeX = Number.isFinite(x) ? x : 0;
    const safeZ = Number.isFinite(z) ? z : 0;
    const distXZ = Math.sqrt(safeX * safeX + safeZ * safeZ);
    if (distXZ <= radiusM) return [safeX, clampedY, safeZ];
    const scale = radiusM / distXZ;
    return [safeX * scale, clampedY, safeZ * scale];
  }

  /**
   * Clamp a uniform scale factor to [min, max].
   */
  clampScale(scale: number, min: number, max: number): number {
    const safe = Number.isFinite(scale) ? scale : 1.0;
    return Math.max(min, Math.min(max, safe));
  }

  /**
   * Apply position and scale clamping to a full Transform.
   * Rotation is never clamped.
   */
  clampTransform(
    transform: Transform,
    radiusM = DEFAULT_SCENE_RADIUS_M,
    scaleMin = 0.2,
    scaleMax = 2.5,
  ): Transform {
    const clampedPos = this.clampPosition(transform.position, radiusM);
    const rawScale = transform.scale[0];
    const clampedS = this.clampScale(rawScale, scaleMin, scaleMax);
    return {
      position: clampedPos,
      rotation: transform.rotation,
      scale: [clampedS, clampedS, clampedS],
    };
  }
}
