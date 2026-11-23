import * as THREE from 'three';
import { Container, Text } from '@pmndrs/uikit';
import { Badge, Button, Divider, Panel } from '@pmndrs/uikit-horizon';
import {
  DistanceGrabbable,
  Entity,
  Hovered,
  MovementMode,
  PokeInteractable,
  RayInteractable,
  UIKitDocument,
  World,
} from '@iwsdk/core';
import type { VoiceCommandController, VoiceListenState } from '../ai/VoiceCommandController';
import type { AudioStatus, SpatialAudioEngine } from '../audio/SpatialAudioEngine';
import type { XRInteractionAdapter } from '../interaction/XRInteractionAdapter';
import { SceneEngine } from '../scene/SceneEngine';
import type { AtmospherePreset, SceneCommandBatch } from '../scene/SceneState';

export interface SpatialPanelCallbacks {
  onStatusToast: (msg: string) => void;
  onExitXR: () => void;
  onReAnchor: () => void;
}

const ZEN_GARDEN_PRESET: SceneCommandBatch = {
  version: '1.0',
  atmosphere: 'golden',
  assistantMessage: 'Built Zen Courtyard in Spatial HUD',
  commands: [
    { action: 'clear' },
    {
      action: 'spawn',
      asset_id: 'tea_pavilion',
      label: 'Tea Pavilion',
      position: [0, 0, -2.1],
      rotation_y: 0,
      scale: 1,
      color: '#8C583A',
    },
    {
      action: 'spawn',
      asset_id: 'torii_gate',
      label: 'Entrance Torii',
      position: [0, 0, 3.2],
      rotation_y: 0,
      scale: 1,
      color: '#D13B2B',
    },
    {
      action: 'spawn',
      asset_id: 'koi_pond',
      label: 'Koi Pond',
      position: [-2.4, 0, 0.4],
      rotation_y: 0.4,
      scale: 1,
      color: '#358CA8',
    },
    {
      action: 'spawn',
      asset_id: 'cherry_blossom_tree',
      label: 'Sakura Tree',
      position: [2.8, 0, -1.2],
      rotation_y: -0.6,
      scale: 1.05,
      color: '#F29CB8',
    },
    {
      action: 'spawn',
      asset_id: 'stone_lantern',
      label: 'Garden Lantern',
      position: [-1.4, 0, 2.2],
      rotation_y: 0,
      scale: 1,
      color: '#F5B864',
    },
  ],
};

const CYBER_OUTPOST_PRESET: SceneCommandBatch = {
  version: '1.0',
  atmosphere: 'twilight',
  assistantMessage: 'Built Cyber Outpost in Spatial HUD',
  commands: [
    { action: 'clear' },
    {
      action: 'spawn',
      asset_id: 'cyber_tower',
      label: 'Holotower Core',
      position: [0, 0, -1.8],
      rotation_y: 0,
      scale: 1.15,
      color: '#2CD4D9',
    },
    {
      action: 'spawn',
      asset_id: 'hover_rover',
      label: 'Orbital Rover',
      position: [2.2, 0, 1.4],
      rotation_y: -0.7,
      scale: 1,
      color: '#3B82F6',
    },
    {
      action: 'spawn',
      asset_id: 'modern_kiosk',
      label: 'Command Kiosk',
      position: [-2.4, 0, 0.8],
      rotation_y: 0.45,
      scale: 1,
      color: '#3AA78F',
    },
    {
      action: 'spawn',
      asset_id: 'crystal_monolith',
      label: 'Energy Crystal',
      position: [2.4, 0, -1.6],
      rotation_y: 0.2,
      scale: 1,
      color: '#7C5CFF',
    },
  ],
};

const MEDIEVAL_KEEP_PRESET: SceneCommandBatch = {
  version: '1.0',
  atmosphere: 'daylight',
  assistantMessage: 'Built Medieval Plaza in Spatial HUD',
  commands: [
    { action: 'clear' },
    {
      action: 'spawn',
      asset_id: 'medieval_tower',
      label: 'Watchtower Keep',
      position: [-1.8, 0, -2.0],
      rotation_y: 0.35,
      scale: 1,
      color: '#48688C',
    },
    {
      action: 'spawn',
      asset_id: 'fountain_stone',
      label: 'Plaza Fountain',
      position: [0.4, 0, 0.4],
      rotation_y: 0,
      scale: 1,
      color: '#4AA3C2',
    },
    {
      action: 'spawn',
      asset_id: 'stone_arch',
      label: 'Gothic Arch',
      position: [0.4, 0, 3.3],
      rotation_y: 0,
      scale: 1,
      color: '#8C877E',
    },
    {
      action: 'spawn',
      asset_id: 'pine_tree',
      label: 'Alpine Pine',
      position: [2.8, 0, -1.4],
      rotation_y: 0,
      scale: 1.05,
      color: '#3B6E4C',
    },
  ],
};

export class SpatialHorizonPanel {
  private world: World;
  private engine: SceneEngine;
  private xrAdapter: XRInteractionAdapter;
  private voiceController: VoiceCommandController | null = null;
  private spatialAudio: SpatialAudioEngine | null = null;
  private callbacks: SpatialPanelCallbacks;

  private entity: Entity | null = null;
  private doc: UIKitDocument | null = null;
  private statusText: Text | null = null;
  private inspectorText: Text | null = null;
  private voiceBtnText: Text | null = null;
  private audioBtnText: Text | null = null;
  private visible = false;

  constructor(
    world: World,
    engine: SceneEngine,
    xrAdapter: XRInteractionAdapter,
    callbacks: SpatialPanelCallbacks,
    voiceController?: VoiceCommandController,
    spatialAudio?: SpatialAudioEngine,
  ) {
    this.world = world;
    this.engine = engine;
    this.xrAdapter = xrAdapter;
    this.callbacks = callbacks;
    this.voiceController = voiceController ?? null;
    this.spatialAudio = spatialAudio ?? null;
  }

  bindVoiceController(controller: VoiceCommandController): void {
    this.voiceController = controller;
    controller.onStateChange((state, label) => this.syncVoiceState(state, label));
  }

  bindSpatialAudio(audio: SpatialAudioEngine): void {
    this.spatialAudio = audio;
    audio.onStatusChange((status) => this.syncAudioState(status));
  }

  mount(): void {
    const panel = new Panel({
      width: 640,
      padding: 18,
      flexDirection: 'column',
      gap: 10,
      backgroundColor: '#121826',
      borderWidth: 1.5,
      borderColor: '#2a3a54',
    });

    const header = new Container({
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      width: '100%',
    });

    const titleCol = new Container({ flexDirection: 'column', gap: 2 });
    titleCol.add(
      new Text({
        text: 'WORLDCRAFT SPATIAL HUD & XR INSPECTOR',
        fontSize: 15,
        fontWeight: 'bold',
        color: '#f1f5f9',
      }),
    );
    this.statusText = new Text({
      text: 'Meta Horizon UI | Ready for Quest & 3D Studio',
      fontSize: 11,
      color: '#94a3b8',
    });
    titleCol.add(this.statusText);
    header.add(titleCol);
    header.add(new Badge({ variant: 'primary', label: 'IWSDK XR' }));
    panel.add(header);

    panel.add(new Divider({ orientation: 'horizontal' }));

    // Section 1: In-Headset XR Object Inspector
    panel.add(
      new Text({
        text: 'XR INSPECTOR (SELECTED ENTITY)',
        fontSize: 11,
        fontWeight: 'semi-bold',
        color: '#38bdf8',
      }),
    );
    this.inspectorText = new Text({
      text: 'No object selected | Tap Next or grab any item in XR',
      fontSize: 11,
      color: '#cbd5e1',
    });
    panel.add(this.inspectorText);

    const inspectorRow = new Container({
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 7,
      width: '100%',
    });
    inspectorRow.add(
      this.makeButton('< Prev', 'secondary', () => this.cycleSelection(-1)),
      this.makeButton('Next >', 'secondary', () => this.cycleSelection(1)),
      this.makeButton('Rot -45', 'tertiary', () => this.nudgeSelected({ rotDelta: Math.PI / 4 })),
      this.makeButton('Rot +45', 'tertiary', () => this.nudgeSelected({ rotDelta: -Math.PI / 4 })),
      this.makeButton('Scale -', 'tertiary', () => this.nudgeSelected({ scaleFactor: 0.85 })),
      this.makeButton('Scale +', 'tertiary', () => this.nudgeSelected({ scaleFactor: 1.18 })),
      this.makeButton('Dup', 'secondary', () => {
        const id = this.engine.getSelectedId();
        if (id) {
          this.engine.duplicateObject(id);
        } else {
          this.callbacks.onStatusToast('Select an object first');
        }
      }),
      this.makeButton('Delete', 'negative', () => {
        const id = this.engine.getSelectedId();
        if (id) {
          this.engine.deleteObject(id);
        } else {
          this.callbacks.onStatusToast('Select an object first');
        }
      }),
    );
    panel.add(inspectorRow);

    panel.add(new Divider({ orientation: 'horizontal' }));

    // Section 2: Theme Quick-Builders & Quick Spawn
    panel.add(
      new Text({
        text: 'QUICK-BUILD & SPAWN',
        fontSize: 11,
        fontWeight: 'semi-bold',
        color: '#38bdf8',
      }),
    );
    const buildRow = new Container({
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 7,
      width: '100%',
    });
    buildRow.add(
      this.makeButton('Zen Garden', 'primary', () => {
        this.engine.applyCommandBatch(ZEN_GARDEN_PRESET);
        this.callbacks.onStatusToast('Built Zen Garden preset');
      }),
      this.makeButton('Cyber Outpost', 'secondary', () => {
        this.engine.applyCommandBatch(CYBER_OUTPOST_PRESET);
        this.callbacks.onStatusToast('Built Cyber Outpost preset');
      }),
      this.makeButton('Medieval Plaza', 'secondary', () => {
        this.engine.applyCommandBatch(MEDIEVAL_KEEP_PRESET);
        this.callbacks.onStatusToast('Built Medieval Plaza preset');
      }),
      this.makeButton('+ Torii', 'tertiary', () => this.engine.spawnManual('torii_gate')),
      this.makeButton('+ Holotower', 'tertiary', () => this.engine.spawnManual('cyber_tower')),
      this.makeButton('+ Rover', 'tertiary', () => this.engine.spawnManual('hover_rover')),
    );
    panel.add(buildRow);

    // Section 3: Atmosphere
    const atmoRow = new Container({
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 7,
      width: '100%',
    });
    for (const [label, preset] of [
      ['Daylight', 'daylight'],
      ['Golden', 'golden'],
      ['Twilight', 'twilight'],
    ] as [string, AtmospherePreset][]) {
      atmoRow.add(
        this.makeButton(label, 'secondary', () => {
          this.engine.setAtmosphere(preset);
          this.callbacks.onStatusToast(`Atmosphere: ${label}`);
        }),
      );
    }
    panel.add(atmoRow);

    panel.add(new Divider({ orientation: 'horizontal' }));

    // Section 4: Voice Cmd, Undo, Re-Anchor, Close/Exit XR
    const actionRow = new Container({
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      gap: 7,
      width: '100%',
    });

    const voiceBtn = new Button({
      variant: 'primary',
      size: 'sm',
      paddingX: 12,
      minWidth: 94,
      onClick: () => {
        void this.voiceController?.toggleListening();
      },
    });
    this.voiceBtnText = new Text({
      text: 'Voice Cmd',
      fontSize: 11,
      fontWeight: 'medium',
    });
    voiceBtn.add(this.voiceBtnText);

    const audioBtn = new Button({
      variant: 'secondary',
      size: 'sm',
      paddingX: 11,
      minWidth: 82,
      onClick: () => {
        if (!this.spatialAudio) return;
        const enabled = this.spatialAudio.toggleEnabled();
        this.callbacks.onStatusToast(
          enabled ? '3D positional audio enabled' : 'Spatial audio muted',
        );
      },
    });
    this.audioBtnText = new Text({
      text: this.spatialAudio?.getStatus().enabled === false ? 'Audio: Off' : 'Audio: On',
      fontSize: 11,
      fontWeight: 'medium',
    });
    audioBtn.add(this.audioBtnText);

    actionRow.add(
      voiceBtn,
      audioBtn,
      this.makeButton('Undo', 'secondary', () => {
        if (!this.engine.undo()) {
          this.callbacks.onStatusToast('Nothing to undo');
        }
      }),
      this.makeButton('Re-Anchor Table', 'secondary', () => {
        this.callbacks.onReAnchor();
      }),
      this.makeButton('Hide / Exit XR', 'negative', () => {
        if (this.xrAdapter.getStatus().inXR) {
          this.callbacks.onExitXR();
        } else {
          this.setVisible(false);
        }
      }),
    );
    panel.add(actionRow);

    this.doc = new UIKitDocument(panel);
    this.doc.setTargetDimensions(2.55, 2.12);

    const anchorGroup = new THREE.Group();
    anchorGroup.name = 'HorizonSpatialHUD';
    anchorGroup.add(this.doc);
    anchorGroup.position.set(-2.35, 3.25, -1.95);
    anchorGroup.rotation.order = 'YXZ';
    anchorGroup.rotation.set(-0.22, 0.62, 0);
    anchorGroup.visible = false;

    this.entity = this.world.createTransformEntity(anchorGroup, {
      parent: this.world.sceneEntity,
    });
    this.entity.addComponent(RayInteractable);
    this.entity.addComponent(PokeInteractable);
    this.entity.addComponent(DistanceGrabbable, {
      translate: true,
      rotate: true,
      scale: false,
      movementMode: MovementMode.MoveAtSource,
    });

    this.engine.onChange(() => this.refreshSummary());
    this.engine.onSelectionChange(() => this.refreshSummary());
    this.xrAdapter.onStatusChange((status) => {
      if (status.inXR) {
        this.setVisible(true);
        if (this.entity?.object3D) {
          this.doc?.setTargetDimensions(0.76, 0.62);
          this.entity.object3D.position.set(0.78, 1.32, -1.05);
          this.entity.object3D.rotation.order = 'YXZ';
          this.entity.object3D.rotation.set(-0.08, -0.38, 0);
        }
      } else if (this.entity?.object3D) {
        this.doc?.setTargetDimensions(2.55, 2.12);
        this.entity.object3D.position.set(-2.35, 3.25, -1.95);
        this.entity.object3D.rotation.order = 'YXZ';
        this.entity.object3D.rotation.set(-0.22, 0.62, 0);
      }
      this.refreshSummary();
    });
  }

  private cycleSelection(dir: 1 | -1): void {
    const items = this.engine.state.getAllObjects();
    if (items.length === 0) {
      this.callbacks.onStatusToast('Scene is empty');
      return;
    }
    const currIdx = items.findIndex((o) => o.id === this.engine.getSelectedId());
    const nextIdx =
      currIdx === -1 ? 0 : (currIdx + dir + items.length) % items.length;
    this.engine.setSelectedId(items[nextIdx].id);
  }

  private nudgeSelected(opts: { rotDelta?: number; scaleFactor?: number }): void {
    const id = this.engine.getSelectedId();
    const obj = id ? this.engine.state.getObject(id) : undefined;
    if (!id || !obj) {
      this.callbacks.onStatusToast('Select an object with Next > or grab it first');
      return;
    }
    this.engine.updateObjectTransform(id, {
      ...(opts.rotDelta !== undefined ? { rotation_y: obj.rotation_y + opts.rotDelta } : {}),
      ...(opts.scaleFactor !== undefined ? { scale: obj.scale * opts.scaleFactor } : {}),
    });
  }

  private syncVoiceState(state: VoiceListenState, _label: string): void {
    if (!this.voiceBtnText) return;
    const text =
      state === 'listening'
        ? 'Listening...'
        : state === 'transcribing'
          ? 'Transcribing...'
          : state === 'executing'
            ? 'Running...'
            : 'Voice Cmd';
    this.voiceBtnText.setProperties({ text });
  }

  private syncAudioState(status: AudioStatus): void {
    if (this.audioBtnText) {
      this.audioBtnText.setProperties({
        text: status.enabled ? 'Audio: On' : 'Audio: Off',
      });
    }
    this.refreshSummary();
  }

  private makeButton(
    label: string,
    variant: 'primary' | 'secondary' | 'tertiary' | 'negative',
    onPress: () => void,
  ): Button {
    const btn = new Button({
      variant,
      size: 'sm',
      paddingX: 11,
      minWidth: 60,
      onClick: () => onPress(),
    });
    btn.add(new Text({ text: label, fontSize: 11, fontWeight: 'medium' }));
    return btn;
  }

  isHovered(): boolean {
    return Boolean(this.entity?.hasComponent(Hovered));
  }

  isVisible(): boolean {
    return this.visible;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (this.entity?.object3D) {
      this.entity.object3D.visible = visible;
    }
    this.refreshSummary();
  }

  toggle(): boolean {
    this.setVisible(!this.visible);
    return this.visible;
  }

  private refreshSummary(): void {
    if (this.statusText) {
      const count = this.engine.state.getCount();
      const xr = this.xrAdapter.getStatus();
      const audioStatus = this.spatialAudio?.getStatus();
      const audioTag = audioStatus
        ? audioStatus.enabled
          ? `HRTF ${audioStatus.activeSources}src`
          : 'Audio Muted'
        : 'HRTF Ready';
      const mode = xr.inXR
        ? xr.surfaceAnchored
          ? 'AR Anchored'
          : 'AR Hit-Test Active'
        : '3D Spatial Studio';
      this.statusText.setProperties({
        text: `${mode} | ${count} objects | ${audioTag} | ${this.engine.state.atmosphere}`,
      });
    }

    if (this.inspectorText) {
      const selId = this.engine.getSelectedId();
      const sel = selId ? this.engine.state.getObject(selId) : undefined;
      if (!sel) {
        this.inspectorText.setProperties({
          text: 'No object selected | Tap Next > or grab any 3D object',
        });
      } else {
        const deg = Math.round((sel.rotation_y * 180) / Math.PI);
        this.inspectorText.setProperties({
          text: `${sel.label} | (${sel.position[0].toFixed(1)}, ${sel.position[1].toFixed(1)}, ${sel.position[2].toFixed(1)})m | ${deg} deg | ${sel.scale.toFixed(2)}x`,
        });
      }
    }
  }

  dispose(): void {
    this.doc?.dispose();
    if (this.entity) {
      try {
        this.entity.destroy();
      } catch {
        // Safe cleanup
      }
    }
  }
}
