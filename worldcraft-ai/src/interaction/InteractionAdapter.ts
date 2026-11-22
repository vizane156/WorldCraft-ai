/**
 * InteractionAdapter — platform abstraction layer.
 *
 * All platform-specific input (mouse, IWER, Quest hands) is translated into
 * InteractionEvents by the adapter. Everything downstream is unaware of which
 * adapter is active.
 *
 * Two concrete implementations:
 *   - DesktopInteractionAdapter  (mouse / keyboard — standard 2D browser)
 *   - XRInteractionAdapter       (IWSDK ECS — IWER emulator or physical Quest)
 */

// ─── Shared value types ────────────────────────────────────────────────────

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // [x, y, z, w]

export interface Transform {
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
}

// ─── Interaction events ────────────────────────────────────────────────────

/**
 * Fired once when the user confirms the scene placement surface.
 * Desktop: first canvas click (origin fixed at [0, 0, 0]).
 * XR: pinch gesture on a horizontal surface detected by EnvironmentRaycastSystem.
 */
export interface SurfaceConfirmedEvent {
  type: 'surfaceConfirmed';
  origin: Transform;
}

/** User selected (clicked / pinched) a scene object. */
export interface ObjectSelectedEvent {
  type: 'objectSelected';
  objectId: string;
}

/** Selected object is being moved (called every frame while held). */
export interface ObjectMovedEvent {
  type: 'objectMoved';
  objectId: string;
  position: Vec3;
}

/** Selected object is being rotated (Y axis). */
export interface ObjectRotatedEvent {
  type: 'objectRotated';
  objectId: string;
  /** Absolute Y rotation in radians. */
  rotationY: number;
}

/** Selected object is being scaled (two-hand or scroll). */
export interface ObjectScaledEvent {
  type: 'objectScaled';
  objectId: string;
  /** Uniform scale factor. */
  scale: number;
}

/**
 * User released the object. Contains the final transform after the interaction.
 * BoundaryGuard clamping is applied by main.ts on receiving this event.
 */
export interface ObjectReleasedEvent {
  type: 'objectReleased';
  objectId: string;
  transform: Transform;
}

export type InteractionEvent =
  | SurfaceConfirmedEvent
  | ObjectSelectedEvent
  | ObjectMovedEvent
  | ObjectRotatedEvent
  | ObjectScaledEvent
  | ObjectReleasedEvent;

// ─── Adapter interface ─────────────────────────────────────────────────────

export type InteractionEventHandler = (event: InteractionEvent) => void;

export interface InteractionAdapter {
  /**
   * Called once per frame by the render loop.
   * @param delta — time since last frame in seconds.
   */
  update(delta: number): void;

  /**
   * Subscribe to interaction events.
   * @returns Unsubscribe function — call it to remove the handler.
   */
  on(handler: InteractionEventHandler): () => void;

  /** Release all resources (event listeners, ECS subscriptions, etc.). */
  dispose(): void;
}
