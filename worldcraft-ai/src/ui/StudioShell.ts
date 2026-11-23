/**
 * StudioShell — full-screen studio layout shell coordinating:
 *   - 3-zone top bar (Brand | Camera + Atmosphere presets | Undo/Redo/Snapshot/Share/Export/Hide UI)
 *   - Left SceneInspectorPanel
 *   - Right ChatPanel
 *   - Mobile drawer switcher bar
 *   - Toast notifications & document.body state attributes
 */

import type { CommandRequestOptions, CommandResponse } from '../ai/CommandClient';
import type { PersistenceClient } from '../persistence/PersistenceClient';
import type { SceneEngine } from '../scene/SceneEngine';
import type { AtmospherePreset, SceneState } from '../scene/SceneState';
import type { CameraPreset } from '../scene/StudioEnvironment';
import { ChatPanel, type ChatSubmission } from './ChatPanel';
import { SceneInspectorPanel } from './SceneInspectorPanel';

export interface StudioShellCallbacks {
  onCameraPreset: (preset: CameraPreset) => void;
  onAtmospherePreset: (preset: AtmospherePreset) => void;
  onUndo: () => Promise<void>;
  onRedo: () => Promise<void>;
  onSnapshot: () => void;
  onShare: () => void;
  onExportJson: () => void;
  onPlaceAsset: (assetId: string) => void;
  onSaveScene: (commandLabel: string) => void;
  onRestoreVersion: (version: number) => Promise<void>;
  onSubmitCommand: (submission: ChatSubmission) => Promise<CommandResponse>;
  onEnhanceScene: () => Promise<CommandResponse>;
}

export class StudioShell {
  readonly root: HTMLElement;
  readonly inspector: SceneInspectorPanel;
  readonly chat: ChatPanel;

  private engine: SceneEngine;
  private state: SceneState;
  private callbacks: StudioShellCallbacks;

  private undoBtn: HTMLButtonElement;
  private redoBtn: HTMLButtonElement;
  private zenBtn: HTMLButtonElement;
  private mobileZenBtn: HTMLButtonElement;
  private mobileSceneBtn: HTMLButtonElement;
  private mobileChatBtn: HTMLButtonElement;
  private toastEl: HTMLElement;
  private toastTimer: number | null = null;

  private atmosphereBtns = new Map<AtmospherePreset, HTMLButtonElement>();
  private zenMode = false;
  private mobileDrawer: 'scene' | 'chat' = 'chat';

  constructor(
    engine: SceneEngine,
    state: SceneState,
    persistence: PersistenceClient,
    callbacks: StudioShellCallbacks,
  ) {
    this.engine = engine;
    this.state = state;
    this.callbacks = callbacks;

    this.root = document.createElement('div');
    this.root.className = 'wc-shell';

    // ── Top Bar ──────────────────────────────────────────────────────────────
    const topbar = document.createElement('header');
    topbar.className = 'wc-topbar';

    const brand = document.createElement('div');
    brand.className = 'wc-brand';
    brand.textContent = 'WorldCraft AI';

    const center = document.createElement('div');
    center.className = 'wc-topbar-center';

    // Camera Presets
    const camGroup = document.createElement('div');
    camGroup.className = 'wc-seg-group';
    camGroup.setAttribute('role', 'group');
    camGroup.setAttribute('aria-label', 'Camera presets');

    const camDefs: Array<{ id: CameraPreset; label: string }> = [
      { id: 'iso', label: 'Iso' },
      { id: 'top', label: 'Top' },
      { id: 'front', label: 'Front' },
      { id: 'reset', label: 'Reset' },
    ];
    for (const cam of camDefs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wc-seg-btn';
      btn.textContent = cam.label;
      btn.dataset.cameraPreset = cam.id;
      btn.addEventListener('click', () => this.callbacks.onCameraPreset(cam.id));
      camGroup.appendChild(btn);
    }

    // Atmosphere Presets
    const atmoGroup = document.createElement('div');
    atmoGroup.className = 'wc-seg-group';
    atmoGroup.setAttribute('role', 'group');
    atmoGroup.setAttribute('aria-label', 'Atmosphere presets');

    const atmoDefs: Array<{ id: AtmospherePreset; label: string }> = [
      { id: 'daylight', label: 'Daylight' },
      { id: 'golden_hour', label: 'Golden' },
      { id: 'twilight_lanterns', label: 'Twilight' },
    ];
    for (const atmo of atmoDefs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wc-seg-btn';
      btn.textContent = atmo.label;
      btn.dataset.atmospherePreset = atmo.id;
      btn.addEventListener('click', () =>
        this.callbacks.onAtmospherePreset(atmo.id),
      );
      atmoGroup.appendChild(btn);
      this.atmosphereBtns.set(atmo.id, btn);
    }

    center.append(camGroup, atmoGroup);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'wc-topbar-actions';

    this.undoBtn = document.createElement('button');
    this.undoBtn.type = 'button';
    this.undoBtn.className = 'wc-btn';
    this.undoBtn.textContent = 'Undo';
    this.undoBtn.dataset.testid = 'undo-btn';
    this.undoBtn.addEventListener('click', () => {
      void this.callbacks.onUndo();
    });

    this.redoBtn = document.createElement('button');
    this.redoBtn.type = 'button';
    this.redoBtn.className = 'wc-btn';
    this.redoBtn.textContent = 'Redo';
    this.redoBtn.dataset.testid = 'redo-btn';
    this.redoBtn.addEventListener('click', () => {
      void this.callbacks.onRedo();
    });

    const snapBtn = document.createElement('button');
    snapBtn.type = 'button';
    snapBtn.className = 'wc-btn';
    snapBtn.textContent = 'Snapshot';
    snapBtn.addEventListener('click', () => this.callbacks.onSnapshot());

    const shareBtn = document.createElement('button');
    shareBtn.type = 'button';
    shareBtn.className = 'wc-btn';
    shareBtn.textContent = 'Share';
    shareBtn.addEventListener('click', () => this.callbacks.onShare());

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'wc-btn';
    exportBtn.textContent = 'Export';
    exportBtn.addEventListener('click', () => this.callbacks.onExportJson());

    this.zenBtn = document.createElement('button');
    this.zenBtn.type = 'button';
    this.zenBtn.className = 'wc-btn wc-desktop-only';
    this.zenBtn.textContent = 'Hide UI';
    this.zenBtn.addEventListener('click', () => this.toggleZenMode());

    actions.append(
      this.undoBtn,
      this.redoBtn,
      snapBtn,
      shareBtn,
      exportBtn,
      this.zenBtn,
    );

    topbar.append(brand, center, actions);

    // ── Workspace ────────────────────────────────────────────────────────────
    const workspace = document.createElement('div');
    workspace.className = 'wc-workspace';

    this.inspector = new SceneInspectorPanel(engine, state, persistence, {
      onPlaceAsset: callbacks.onPlaceAsset,
      onSaveScene: callbacks.onSaveScene,
      onRestoreVersion: callbacks.onRestoreVersion,
      onToast: (msg) => this.showToast(msg),
    });

    this.chat = new ChatPanel(callbacks.onSubmitCommand, callbacks.onEnhanceScene);

    workspace.append(this.inspector.element, this.chat.element);

    // ── Mobile Switcher Bar ──────────────────────────────────────────────────
    const mobileBar = document.createElement('div');
    mobileBar.className = 'wc-mobile-bar';

    this.mobileSceneBtn = document.createElement('button');
    this.mobileSceneBtn.type = 'button';
    this.mobileSceneBtn.className = 'wc-btn';
    this.mobileSceneBtn.textContent = 'Scene';
    this.mobileSceneBtn.addEventListener('click', () =>
      this.setMobileDrawer('scene'),
    );

    this.mobileChatBtn = document.createElement('button');
    this.mobileChatBtn.type = 'button';
    this.mobileChatBtn.className = 'wc-btn wc-btn-primary';
    this.mobileChatBtn.textContent = 'AI Chat';
    this.mobileChatBtn.addEventListener('click', () =>
      this.setMobileDrawer('chat'),
    );

    this.mobileZenBtn = document.createElement('button');
    this.mobileZenBtn.type = 'button';
    this.mobileZenBtn.className = 'wc-btn';
    this.mobileZenBtn.textContent = 'Hide UI';
    this.mobileZenBtn.addEventListener('click', () => this.toggleZenMode());

    mobileBar.append(this.mobileSceneBtn, this.mobileChatBtn, this.mobileZenBtn);

    // ── Toast ────────────────────────────────────────────────────────────────
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'wc-toast';
    this.toastEl.style.display = 'none';
    this.toastEl.setAttribute('role', 'status');

    this.root.append(topbar, workspace, mobileBar, this.toastEl);
    document.body.appendChild(this.root);

    this.engine.on('sceneChanged', () => this.syncState());
    this.engine.on('selectionChanged', () => this.syncState());
    this.engine.on('atmosphereChanged', () => this.syncState());

    this.setMobileDrawer('chat');
    this.syncState();
  }

  showToast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.style.display = 'block';
    if (this.toastTimer !== null) {
      window.clearTimeout(this.toastTimer);
    }
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.style.display = 'none';
      this.toastTimer = null;
    }, 2600);
  }

  toggleZenMode(): void {
    this.zenMode = !this.zenMode;
    this.root.classList.toggle('zen-mode', this.zenMode);
    const label = this.zenMode ? 'Show UI' : 'Hide UI';
    this.zenBtn.textContent = label;
    this.mobileZenBtn.textContent = label;
  }

  setMobileDrawer(drawer: 'scene' | 'chat'): void {
    this.mobileDrawer = drawer;
    if (this.zenMode) this.toggleZenMode();
    this.inspector.setMobileVisible(drawer === 'scene');
    this.chat.setMobileVisible(drawer === 'chat');
    this.mobileSceneBtn.classList.toggle('wc-btn-primary', drawer === 'scene');
    this.mobileChatBtn.classList.toggle('wc-btn-primary', drawer === 'chat');
  }

  syncState(): void {
    this.undoBtn.disabled = !this.state.canUndo();
    this.redoBtn.disabled = !this.state.canRedo();

    const atmosphere = this.state.getAtmosphere();
    for (const [preset, btn] of this.atmosphereBtns) {
      btn.classList.toggle('active', preset === atmosphere);
    }

    document.body.setAttribute('data-scene-objects', String(this.state.size));
    document.body.setAttribute(
      'data-scene-version',
      String(this.state.getVersion()),
    );
    document.body.setAttribute('data-atmosphere', atmosphere);
    document.body.setAttribute(
      'data-selected-id',
      this.engine.getSelectedId() ?? '',
    );
  }
}

export type { CommandRequestOptions };
