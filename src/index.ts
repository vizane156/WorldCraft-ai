import './styles/studio.css';
import { SessionMode, VisibilityState, World } from '@iwsdk/core';
import { CommandClient } from './ai/CommandClient';
import { VoiceCommandController } from './ai/VoiceCommandController';
import { SpatialAudioEngine } from './audio/SpatialAudioEngine';
import { getAsset } from './catalog/assetCatalog';
import { DesktopInteractionAdapter } from './interaction/DesktopInteractionAdapter';
import { XRInteractionAdapter } from './interaction/XRInteractionAdapter';
import { PersistenceClient } from './persistence/PersistenceClient';
import { SceneEngine } from './scene/SceneEngine';
import { StudioEnvironment } from './scene/StudioEnvironment';
import { ChatPanel } from './ui/ChatPanel';
import { SceneInspectorPanel } from './ui/SceneInspectorPanel';
import { SpatialHorizonPanel } from './ui/SpatialHorizonPanel';
import { StudioShell } from './ui/StudioShell';

function resolveSessionId(): string {
  const params = new URLSearchParams(window.location.search);
  const existing = params.get('scene')?.trim();
  if (existing && /^[a-zA-Z0-9_-]{4,80}$/.test(existing)) {
    return existing;
  }
  const fresh = crypto.randomUUID();
  params.set('scene', fresh);
  const nextUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState({}, '', nextUrl);
  return fresh;
}

async function bootstrap(): Promise<void> {
  const appEl = document.getElementById('app');
  if (!appEl) return;

  const sessionId = resolveSessionId();
  const engine = new SceneEngine(sessionId);
  const persistence = new PersistenceClient();
  const commandClient = new CommandClient();
  const voiceController = new VoiceCommandController(engine, commandClient);

  let env: StudioEnvironment | null = null;
  let xrAdapterRef: XRInteractionAdapter | null = null;
  let spatialAudioRef: SpatialAudioEngine | null = null;
  let shell: StudioShell;

  const inspector = new SceneInspectorPanel(engine, {
    onLoadVersions: () => persistence.listVersions(engine.state.sessionId),
    onRestoreVersion: async (versionNumber) => {
      const restored = await persistence.restoreVersion(
        engine.state.sessionId,
        versionNumber,
      );
      engine.loadSnapshot(
        {
          session_id: restored.session_id,
          title: restored.title,
          atmosphere: restored.atmosphere,
          version: restored.version,
          objects: restored.objects,
        },
        'restore',
      );
      shell.showToast(`Restored snapshot v${versionNumber}`);
    },
    onFocusObject: (obj) => {
      if (!env) return;
      env.controls.target.set(obj.position[0], obj.position[1] + 0.65, obj.position[2]);
      env.controls.update();
    },
    onCloseMobile: () => inspector.setMobileOpen(false),
    onGetXRStatus: () =>
      xrAdapterRef?.getStatus() ?? {
        supported: false,
        inXR: false,
        sessionMode: 'inline',
        surfaceAnchored: false,
      },
    onReAnchorXR: () => xrAdapterRef?.reAnchorTabletop(),
    onGetAudioInfo: (id) => spatialAudioRef?.getObjectAudioInfo(id) ?? null,
  });

  const chatPanel = new ChatPanel(
    engine,
    commandClient,
    () => chatPanel.setMobileOpen(false),
    voiceController,
  );
  chatPanel.bindVoiceController(voiceController);

  shell = new StudioShell(appEl, engine, inspector, chatPanel);

  // Initialize Meta IWSDK World attached to the 3D viewport container
  const world = await World.create(shell.viewportStage, {
    xr: {
      sessionMode: SessionMode.ImmersiveAR,
      offer: 'none',
      features: {
        hitTest: true,
        handTracking: true,
        anchors: true,
      },
    },
    render: {
      fov: 48,
      near: 0.08,
      far: 120,
      camera: {
        position: [6.8, 5.2, 7.6],
        lookAt: [0, 0.55, 0],
      },
    },
    features: {
      grabbing: true,
      environmentRaycast: true,
      spatialUI: {
        kit: 'horizon',
        preferredColorScheme: 'dark',
      },
    },
  });

  env = new StudioEnvironment(
    world.scene,
    world.camera,
    world.renderer,
    world.renderer.domElement,
  );
  engine.bindWorld(world);

  const xrAdapter = new XRInteractionAdapter(world, engine, env);
  xrAdapterRef = xrAdapter;
  voiceController.bindXR(xrAdapter);

  const spatialAudio = new SpatialAudioEngine(
    engine,
    world.scene,
    world.camera,
    world.renderer,
  );
  spatialAudio.init();
  spatialAudioRef = spatialAudio;
  xrAdapter.onStatusChange((status) => spatialAudio.setInXR(status.inXR));

  const spatialHud = new SpatialHorizonPanel(
    world,
    engine,
    xrAdapter,
    {
      onStatusToast: (msg) => shell.showToast(msg),
      onExitXR: () => xrAdapter.exitXR(),
      onReAnchor: () => {
        xrAdapter.reAnchorTabletop();
        shell.showToast(
          xrAdapter.getStatus().inXR
            ? 'Point right controller at a physical surface and press trigger to anchor.'
            : 'Tabletop anchor reset is active when inside Meta Quest AR.',
        );
      },
    },
    voiceController,
    spatialAudio,
  );
  spatialHud.mount();
  spatialHud.bindVoiceController(voiceController);
  spatialHud.bindSpatialAudio(spatialAudio);

  voiceController.bindCallbacks({
    onToast: (msg) => shell.showToast(msg),
    onToggleHud: (visible) => {
      const next = visible !== undefined ? visible : !spatialHud.isVisible();
      spatialHud.setVisible(next);
      shell.showToast(
        next ? 'Horizon 3D Spatial HUD & XR Inspector visible' : 'Spatial HUD hidden',
      );
    },
    onAiPrompt: async (prompt) => {
      await chatPanel.submitPrompt(prompt, 'chat');
    },
  });

  const updateSelectionVisual = () => {
    if (!env) return;
    const selId = engine.getSelectedId();
    const obj = selId ? engine.state.getObject(selId) : undefined;
    if (!obj) {
      env.setSelectionTarget(null);
      return;
    }
    const asset = getAsset(obj.asset_id);
    env.setSelectionTarget(
      {
        x: obj.position[0] * engine.root.scale.x,
        y: obj.position[1] * engine.root.scale.y,
        z: obj.position[2] * engine.root.scale.z,
        radius: (asset?.boundingRadius ?? 0.9) * obj.scale * engine.root.scale.x,
      },
      engine.root.position,
    );
  };

  engine.onSelectionChange(() => {
    updateSelectionVisual();
    triggerSoftwareRender();
  });
  engine.onAtmosphereChange((preset) => {
    env?.setAtmosphere(preset);
    triggerSoftwareRender();
  });

  await xrAdapter.init((_delta, elapsed) => {
    if (!env) return;
    if (world.visibilityState.value === VisibilityState.NonImmersive) {
      env.controls.enabled = !spatialHud.isHovered();
    }
    env.tick(elapsed, engine.root);
    updateSelectionVisual();
    spatialAudio.updateListenerPose();
  });

  const desktopAdapter = new DesktopInteractionAdapter(
    engine,
    env,
    world.renderer.domElement,
  );
  desktopAdapter.attach();

  shell.bindRuntime(env, xrAdapter, spatialHud, voiceController, spatialAudio);

  // Software-WebGL pacing guard for headless environments
  let renderSoonTimer: number | null = null;
  function triggerSoftwareRender(): void {
    if (!env?.isSoftwareGl || world.visibilityState.value !== VisibilityState.NonImmersive) {
      return;
    }
    if (renderSoonTimer !== null) return;
    renderSoonTimer = window.setTimeout(() => {
      renderSoonTimer = null;
      world.update(0.05, performance.now() / 1000);
      world.renderer.render(world.scene, world.camera);
    }, 24);
  }

  // Sync canvas sizing with the responsive #viewport-stage flex box
  const syncViewportSize = () => {
    if (!env || world.visibilityState.value !== VisibilityState.NonImmersive) return;
    const rect = shell.viewportStage.getBoundingClientRect();
    env.resize(Math.max(1, Math.floor(rect.width)), Math.max(1, Math.floor(rect.height)));
    triggerSoftwareRender();
  };
  const ro = new ResizeObserver(syncViewportSize);
  ro.observe(shell.viewportStage);
  syncViewportSize();

  if (env.isSoftwareGl) {
    world.renderer.setAnimationLoop(null);
    let stopped = false;
    const startTime = performance.now();
    const stepSoftwareLoop = () => {
      if (stopped || world.visibilityState.value !== VisibilityState.NonImmersive) return;
      const elapsed = (performance.now() - startTime) / 1000;
      world.update(0.12, elapsed);
      world.renderer.render(world.scene, world.camera);
      window.setTimeout(stepSoftwareLoop, 450);
    };
    window.setTimeout(stepSoftwareLoop, 40);
    env.controls.addEventListener('change', triggerSoftwareRender);
    window.addEventListener('beforeunload', () => {
      stopped = true;
    });
  }

  // Persist scene mutations automatically and update version tag
  engine.onChange((ev) => {
    updateSelectionVisual();
    triggerSoftwareRender();
    if (!ev.persist) return;
    void persistence
      .save(engine.state.toSnapshot(), ev.note)
      .then((saved) => {
        engine.state.version = saved.version;
        shell.syncHeader();
      })
      .catch(() => {
        shell.showToast('Warning: could not sync snapshot to server');
      });
  });

  // Load persisted session or seed welcoming default diorama
  try {
    const existing = await persistence.load(sessionId);
    if (existing.version > 0 || existing.objects.length > 0) {
      engine.loadSnapshot(
        {
          session_id: existing.session_id,
          title: existing.title,
          atmosphere: existing.atmosphere,
          version: existing.version,
          objects: existing.objects,
        },
        'load',
      );
    } else {
      engine.loadSnapshot(
        {
          session_id: sessionId,
          title: 'Tokyo Lantern Courtyard',
          atmosphere: 'daylight',
          version: 0,
          objects: [
            {
              id: 'seed_torii',
              asset_id: 'torii_gate',
              label: 'Vermilion Torii Gate',
              position: [0, 0, 2.8],
              rotation_y: 0,
              scale: 1,
              color: '#D13B2B',
            },
            {
              id: 'seed_pavilion',
              asset_id: 'tea_pavilion',
              label: 'Cedar Tea Pavilion',
              position: [-0.2, 0, -2.1],
              rotation_y: 0,
              scale: 1,
              color: '#8C583A',
            },
            {
              id: 'seed_pond',
              asset_id: 'koi_pond',
              label: 'Koi Reflection Pond',
              position: [-2.4, 0, 0.5],
              rotation_y: 0.4,
              scale: 1,
              color: '#358CA8',
            },
            {
              id: 'seed_sakura',
              asset_id: 'cherry_blossom_tree',
              label: 'Sakura Tree',
              position: [2.7, 0, -1.0],
              rotation_y: -0.5,
              scale: 1.05,
              color: '#F29CB8',
            },
            {
              id: 'seed_lantern',
              asset_id: 'stone_lantern',
              label: 'Toro Stone Lantern',
              position: [1.5, 0, 2.2],
              rotation_y: 0,
              scale: 1,
              color: '#F5B864',
            },
          ],
        },
        'load',
      );
    }
  } catch {
    shell.showToast('Started fresh local workspace');
  }

  // Expose minimal diagnostics hook for automated verification
  (
    window as unknown as {
      __WORLDCRAFT__?: {
        engine: SceneEngine;
        xr: XRInteractionAdapter;
        spatialHud: SpatialHorizonPanel;
        spatialAudio: SpatialAudioEngine;
      };
    }
  ).__WORLDCRAFT__ = {
    engine,
    xr: xrAdapter,
    spatialHud,
    spatialAudio,
  };
}

bootstrap().catch((err) => {
  console.error('WorldCraft AI bootstrap failed:', err);
});
