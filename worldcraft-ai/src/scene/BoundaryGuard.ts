/**
 * BoundaryGuard — pure transform clamping rules.
 *
 * No Three.js, no IWSDK, no networking.
 * Called after every objectReleased event regardless of which adapter fired it.
 */

import type { Vec3, Transform } from '../interaction/InteractionAdapter.js';

export class BoundaryGuard {
  /**
   * Clamp a position to a cylinder of `radiusM` around the scene origin (XZ plane).
   * Y is left unchanged — objects can be placed at any height.
   */
  clampPosition(pos: Vec3, radiusM: number): Vec3 {
    const [x, y, z] = pos;
    const distXZ = Math.sqrt(x * x + z * z);
    if (distXZ <= radiusM) return [x, y, z];
    const scale = radiusM / distXZ;
    return [x * scale, y, z * scale];
  }

  /**
   * Clamp a uniform scale factor to [min, max].
   */
  clampScale(scale: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, scale));
  }

  /**
   * Apply position and scale clamping to a full Transform.
   * Rotation is never clamped.
   */
  clampTransform(
    transform: Transform,
    radiusM: number,
    scaleMin: number,
    scaleMax: number,
  ): Transform {
    const clampedPos = this.clampPosition(transform.position, radiusM);
    // Scale is stored as Vec3; clamp the X component and apply uniformly.
    const rawScale = transform.scale[0];
    const clampedS = this.clampScale(rawScale, scaleMin, scaleMax);
    return {
      position: clampedPos,
      rotation: transform.rotation,
      scale: [clampedS, clampedS, clampedS],
    };
  }
}
