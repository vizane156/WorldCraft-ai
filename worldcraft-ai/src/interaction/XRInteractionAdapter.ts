/**
 * XRInteractionAdapter — IWSDK ECS implementation.
 * Activated when WebXR immersive-ar is available (IWER emulator or physical Quest).
 *
 * Implementation: T-25 / T-26.
 * This stub satisfies the interface so the lazy import in index.ts compiles.
 */

import type { World } from '@iwsdk/core';
import type {
  InteractionAdapter,
  InteractionEventHandler,
} from './InteractionAdapter.js';

export class XRInteractionAdapter implements InteractionAdapter {
  constructor(_world: World) {
    console.warn(
      '[XRInteractionAdapter] Stub — full implementation in T-25/T-26.',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  update(_delta: number): void {}

  on(handler: InteractionEventHandler): () => void {
    void handler;
    return () => {};
  }

  dispose(): void {}
}
