/**
 * WorldCraft AI — entry point.
 *
 * World.create() owns the renderer, WebXR session, ECS runtime, and update loop.
 * Do not create a THREE.WebGLRenderer or request a WebXR session manually.
 *
 * Runtime mode selection:
 *   WebXR immersive-ar available (IWER emulator or physical Quest)
 *     → XRInteractionAdapter   (IWSDK ECS systems)
 *   Standard browser (desktop 2D)
 *     → DesktopInteractionAdapter (mouse / keyboard)
 *
 * All business logic (SceneEngine, SceneState, AI, persistence) is
 * adapter-agnostic — it only consumes InteractionEvents.
 */

import {
  AmbientLight,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  World,
  createSystem,
} from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';

import { SceneState }    from './scene/SceneState.js';
import { SceneEngine }   from './scene/SceneEngine.js';
import { BoundaryGuard } from './scene/BoundaryGuard.js';
import { FeedbackOverlay } from './ui/FeedbackOverlay.js';
import { InputWidget }     from './ui/InputWidget.js';
import { DesktopInteractionAdapter } from './interaction/DesktopInteractionAdapter.js';
import { CommandClient, CommandError } from './ai/CommandClient.js';
import { PersistenceClient }          from './persistence/PersistenceClient.js';

import type { InteractionAdapter } from './interaction/InteractionAdapter.js';

// XRInteractionAdapter imported lazily so it doesn't affect desktop bundle
// until XR mode is confirmed.

const SCENE_RADIUS_M  = 0.5;
const SCALE_MIN       = 0.1;
const SCALE_MAX       = 5.0;

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {

  // ── Core singletons ──────────────────────────────────────────────────────
  const state      = new SceneState();
  const guard      = new BoundaryGuard();
  const engine     = new SceneEngine(state, guard);
  const feedback   = new FeedbackOverlay();
  const persistence = new PersistenceClient();
  const commandClient = new CommandClient(persistence.sessionId);

  // Add the scene root to the Three.js scene
  const threeScene = world.scene as unknown as Scene;
  threeScene.add(engine.root);

  // Desktop background color — overridden by AR passthrough in XR mode
  world.renderer.setClearColor(0x1a1a2e, 1);

  // Basic lighting so placeholder cubes are visible
  const ambient = new AmbientLight(0xffffff, 0.6);
  const sun = new DirectionalLight(0xffffff, 1.2);
  sun.position.set(1, 3, 2);
  threeScene.add(ambient);
  threeScene.add(sun);

  // InputWidget — wired to real CommandClient
  const inputWidget = new InputWidget(feedback, async (text: string) => {
    try {
      const response = await commandClient.sendCommand(text);
      if (response.warnings.length > 0) {
        console.warn('[WorldCraft] Warnings:', response.warnings);
      }
      await engine.execute(response.actions);
      // Persist after successful AI command
      void persistence.save(engine.serialize());
    } catch (err) {
      if (err instanceof CommandError) throw err;
      throw new CommandError('AI_UNAVAILABLE', 'Unexpected error. Please retry.');
    }
  });

  // ── Mode detection and adapter instantiation ─────────────────────────────
  let adapter: InteractionAdapter;

  const supportsXR = typeof navigator !== 'undefined' &&
    navigator.xr != null &&
    typeof navigator.xr.isSessionSupported === 'function';

  void (async () => {
    const xrAvailable = supportsXR &&
      await navigator.xr!.isSessionSupported('immersive-ar').catch(() => false);

    if (xrAvailable) {
      // Lazy import — only loads IWSDK ECS code when XR is confirmed
      const { XRInteractionAdapter } = await import(
        './interaction/XRInteractionAdapter.js'
      );
      adapter = new XRInteractionAdapter(world);
      console.log('[WorldCraft] Mode: XR (IWER / Quest)');
    } else {
      const camera = world.camera as unknown as PerspectiveCamera;
      const canvas = document.getElementById('scene-container') as HTMLElement;
      adapter = new DesktopInteractionAdapter(
        canvas, camera, threeScene, engine, state,
      );
      console.log('[WorldCraft] Mode: Desktop 2D');
    }

    // ── Session restore ─────────────────────────────────────────────────────
    const savedSnapshot = await persistence.load();
    if (savedSnapshot?.objects.length) {
      await engine.deserialize(savedSnapshot);
      if (savedSnapshot.origin) {
        engine.setOrigin(savedSnapshot.origin);
        state.setOrigin(savedSnapshot.origin);
        inputWidget.show();
        console.log('[WorldCraft] Session restored —', savedSnapshot.objects.length, 'objects');
      }
    }

    // ── Event wiring (adapter-agnostic) ────────────────────────────────────
    adapter.on((event) => {
      switch (event.type) {

        case 'surfaceConfirmed': {
          state.setOrigin(event.origin);
          engine.setOrigin(event.origin);
          inputWidget.show();
          console.log('[WorldCraft] Surface confirmed at', event.origin.position);
          break;
        }

        case 'objectSelected': {
          console.log('[WorldCraft] Selected:', event.objectId);
          break;
        }

        case 'objectMoved': {
          // Live preview — no SceneState write, just Three.js update
          engine.previewTransform(event.objectId, event.position);
          break;
        }

        case 'objectRotated': {
          const mesh = engine.getObject3D(event.objectId);
          if (mesh != null) mesh.rotation.y = event.rotationY;
          break;
        }

        case 'objectScaled': {
          const mesh = engine.getObject3D(event.objectId);
          const obj  = state.get(event.objectId);
          if (mesh != null && obj != null) {
            const clamped = guard.clampScale(event.scale, SCALE_MIN, SCALE_MAX);
            mesh.scale.setScalar(clamped);
          }
          break;
        }

        case 'objectReleased': {
          const clamped = guard.clampTransform(
            event.transform,
            SCENE_RADIUS_M,
            SCALE_MIN,
            SCALE_MAX,
          );
          engine.applyTransform(event.objectId, clamped);
          console.log('[WorldCraft] Released:', event.objectId, clamped.position);
          // Persist after hand interaction
          void persistence.save(engine.serialize());
          break;
        }
      }
    });

    // ── Render loop hook ────────────────────────────────────────────────────
    // Wrap adapter.update() in a lightweight ECS system so it runs each frame.
    class AdapterUpdateSystem extends createSystem({}) {
      override update(delta: number): void {
        adapter.update(delta);
      }
    }
    world.registerSystem(AdapterUpdateSystem);

  })();
});
