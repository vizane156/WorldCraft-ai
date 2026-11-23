/**
 * WorldCraft AI — main entry point.
 *
 * Initializes the IWSDK World, StudioEnvironment (RoomEnvironment IBL,
 * 3-point lighting, OrbitControls, tabletop plinth), procedural PBR SceneEngine,
 * Desktop / WebXR interaction adapters, versioned PersistenceClient, multimodal
 * CommandClient, and the StudioShell UI.
 */

import './styles/studio.css';
import {
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  World,
  createSystem,
} from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';

import { SceneState } from './scene/SceneState';
import { SceneEngine } from './scene/SceneEngine';
import { BoundaryGuard, DEFAULT_SCENE_RADIUS_M } from './scene/BoundaryGuard';
import { StudioEnvironment } from './scene/StudioEnvironment';
import { DesktopInteractionAdapter } from './interaction/DesktopInteractionAdapter';
import { CommandClient, CommandError } from './ai/CommandClient';
import { PersistenceClient } from './persistence/PersistenceClient';
import { StudioShell } from './ui/StudioShell';
import type { InteractionAdapter } from './interaction/InteractionAdapter';

const SCALE_MIN = 0.25;
const SCALE_MAX = 2.5;

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadDataUrl(filename: string, dataUrl: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  const threeScene = world.scene as unknown as Scene;
  const camera = world.camera as unknown as PerspectiveCamera;
  const renderer = world.renderer as unknown as WebGLRenderer;

  // ── Core singletons ──────────────────────────────────────────────────────
  const state = new SceneState();
  const guard = new BoundaryGuard();
  const engine = new SceneEngine(state, guard);
  const persistence = new PersistenceClient();
  const commandClient = new CommandClient(persistence.sessionId);
  const studioEnv = new StudioEnvironment(
    threeScene,
    camera,
    renderer,
    DEFAULT_SCENE_RADIUS_M,
  );

  threeScene.add(engine.root);

  // Keep StudioEnvironment atmosphere & selection ring synced with SceneEngine
  const syncSelectionRing = (): void => {
    const selected = engine.getSelectedObject();
    if (selected) {
      studioEnv.setSelectionIndicator(
        true,
        selected.transform.position[0],
        selected.transform.position[2],
        selected.transform.scale[0],
      );
    } else {
      studioEnv.setSelectionIndicator(false);
    }
  };

  engine.on('selectionChanged', syncSelectionRing);
  engine.on('objectTransformed', syncSelectionRing);
  engine.on('sceneChanged', syncSelectionRing);
  engine.on('atmosphereChanged', () => {
    studioEnv.setAtmosphere(state.getAtmosphere());
  });

  // ── Studio UI Shell ──────────────────────────────────────────────────────
  const shell = new StudioShell(engine, state, persistence, {
    onCameraPreset: (preset) => studioEnv.setCameraPreset(preset),
    onAtmospherePreset: (preset) => {
      engine.setAtmosphereManual(preset);
      void persistence.save(engine.serialize(), `Atmosphere: ${preset}`);
    },
    onUndo: async () => {
      if (await engine.undo()) {
        void persistence.save(engine.serialize(), 'Undo');
        shell.showToast('Undid last change');
      }
    },
    onRedo: async () => {
      if (await engine.redo()) {
        void persistence.save(engine.serialize(), 'Redo');
        shell.showToast('Redid change');
      }
    },
    onSnapshot: () => {
      renderer.render(threeScene, camera);
      const dataUrl = renderer.domElement.toDataURL('image/png');
      downloadDataUrl(`worldcraft-scene-v${state.getVersion()}.png`, dataUrl);
      shell.showToast('PNG snapshot downloaded');
    },
    onShare: () => {
      const shareUrl = persistence.getShareUrl();
      window.history.replaceState({}, '', shareUrl);
      if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(shareUrl).catch(() => {});
      }
      shell.showToast('Shareable scene URL copied');
    },
    onExportJson: () => {
      const json = JSON.stringify(engine.serialize(), null, 2);
      downloadBlob(
        `worldcraft-scene-v${state.getVersion()}.json`,
        new Blob([json], { type: 'application/json' }),
      );
      shell.showToast('Scene JSON exported');
    },
    onPlaceAsset: (assetId) => {
      const placed = engine.placeAssetManual(assetId);
      if (placed) {
        void persistence.save(engine.serialize(), `Placed ${placed.label}`);
      } else {
        shell.showToast('Scene object limit (20) reached');
      }
    },
    onSaveScene: (commandLabel) => {
      void persistence.save(engine.serialize(), commandLabel);
    },
    onRestoreVersion: async (version) => {
      const snap = await persistence.restoreVersion(version);
      if (!snap) {
        shell.showToast(`Failed to restore v${version}`);
        return;
      }
      await engine.deserialize(snap);
      shell.showToast(`Restored version v${version}`);
    },
    onSubmitCommand: async (submission) => {
      try {
        const res = await commandClient.sendCommand(
          submission.text,
          submission.options,
        );
        await engine.execute(res.actions);
        return res;
      } catch (err) {
        if (err instanceof CommandError) throw err;
        throw new CommandError(
          'AI_UNAVAILABLE',
          'Unexpected error reaching AI Scene Director.',
        );
      }
    },
    onEnhanceScene: async () => {
      try {
        const res = await commandClient.sendCommand('Enhance scene layout', {
          mode: 'enhance',
        });
        await engine.execute(res.actions);
        return res;
      } catch (err) {
        if (err instanceof CommandError) throw err;
        throw new CommandError(
          'AI_UNAVAILABLE',
          'Unexpected error enhancing scene.',
        );
      }
    },
  });

  // ── Mode detection and adapter instantiation ─────────────────────────────
  let adapter: InteractionAdapter | null = null;

  const supportsXR =
    typeof navigator !== 'undefined' &&
    navigator.xr != null &&
    typeof navigator.xr.isSessionSupported === 'function';

  void (async () => {
    const xrAvailable =
      supportsXR &&
      (await navigator.xr!.isSessionSupported('immersive-ar').catch(() => false));

    if (xrAvailable) {
      const { XRInteractionAdapter } = await import(
        './interaction/XRInteractionAdapter'
      );
      adapter = new XRInteractionAdapter(world);
    } else {
      const canvasEl = document.getElementById('scene-container') as HTMLElement;
      const desktopAdapter = new DesktopInteractionAdapter(
        canvasEl,
        camera,
        threeScene,
        engine,
        state,
        (enabled) => studioEnv.setControlsEnabled(enabled),
      );
      desktopAdapter.confirmDefaultOrigin();
      adapter = desktopAdapter;
    }

    // ── Session restore ─────────────────────────────────────────────────────
    const savedSnapshot = await persistence.load();
    if (savedSnapshot) {
      await engine.deserialize(savedSnapshot);
      if (savedSnapshot.origin) {
        engine.setOrigin(savedSnapshot.origin);
        state.setOrigin(savedSnapshot.origin);
      }
    }

    // ── Adapter event wiring ────────────────────────────────────────────────
    adapter.on((event) => {
      switch (event.type) {
        case 'surfaceConfirmed': {
          state.setOrigin(event.origin);
          engine.setOrigin(event.origin);
          break;
        }
        case 'objectSelected': {
          engine.setSelectedId(event.objectId);
          break;
        }
        case 'objectMoved': {
          engine.previewTransform(event.objectId, event.position);
          syncSelectionRing();
          break;
        }
        case 'objectRotated': {
          const mesh = engine.getObject3D(event.objectId);
          if (mesh != null) mesh.rotation.y = event.rotationY;
          break;
        }
        case 'objectScaled': {
          const mesh = engine.getObject3D(event.objectId);
          if (mesh != null) {
            const clamped = guard.clampScale(event.scale, SCALE_MIN, SCALE_MAX);
            mesh.scale.setScalar(clamped);
          }
          break;
        }
        case 'objectReleased': {
          const clamped = guard.clampTransform(
            event.transform,
            DEFAULT_SCENE_RADIUS_M,
            SCALE_MIN,
            SCALE_MAX,
          );
          engine.applyTransform(event.objectId, clamped);
          const obj = state.get(event.objectId);
          void persistence.save(
            engine.serialize(),
            `Adjusted ${obj?.label ?? 'object'}`,
          );
          break;
        }
      }
    });

    // ── Render loop & pacing ────────────────────────────────────────────────
    if (studioEnv.isSoftwareGl && !renderer.xr.isPresenting) {
      // Pace software-WebGL (SwiftShader) frames with fenceSync + 80ms gap so
      // headless browsers remain responsive for UI interaction & screenshots.
      renderer.setAnimationLoop(null);
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const startMs = performance.now();
      let lastMs = startMs;

      const afterDraw = (done: () => void): void => {
        if (typeof gl.fenceSync === 'function') {
          const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
          if (sync) {
            const check = (): void => {
              const status = gl.clientWaitSync(sync, 0, 0);
              if (status === gl.WAIT_FAILED || status === gl.CONDITION_SATISFIED || status === gl.ALREADY_SIGNALED) {
                gl.deleteSync(sync);
                done();
              } else {
                setTimeout(check, 8);
              }
            };
            gl.flush();
            setTimeout(check, 0);
            return;
          }
        }
        setTimeout(done, 16);
      };

      const step = (): void => {
        const now = performance.now();
        const delta = Math.min((now - lastMs) / 1000, 0.1);
        const elapsed = (now - startMs) / 1000;
        lastMs = now;

        adapter?.update(delta);
        world.update(delta, elapsed);
        studioEnv.update(delta, elapsed);
        engine.tickAnimations(elapsed);
        renderer.render(threeScene, camera);

        afterDraw(() => setTimeout(step, 80));
      };

      step();
    } else {
      class StudioUpdateSystem extends createSystem({}) {
        override update(delta: number, elapsed: number): void {
          adapter?.update(delta);
          studioEnv.update(delta, elapsed);
          engine.tickAnimations(elapsed);
        }
      }
      world.registerSystem(StudioUpdateSystem);
    }
  })();
});
