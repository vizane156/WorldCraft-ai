import type { VoiceCommandController, VoiceListenState } from '../ai/VoiceCommandController';
import type { AudioStatus, SpatialAudioEngine } from '../audio/SpatialAudioEngine';
import type { XRInteractionAdapter, XRStatus } from '../interaction/XRInteractionAdapter';
import { SceneEngine } from '../scene/SceneEngine';
import type { AtmospherePreset } from '../scene/SceneState';
import { CameraPreset, StudioEnvironment } from '../scene/StudioEnvironment';
import { ChatPanel } from './ChatPanel';
import { SceneInspectorPanel } from './SceneInspectorPanel';
import type { SpatialHorizonPanel } from './SpatialHorizonPanel';

export class StudioShell {
  readonly root: HTMLElement;
  readonly viewportStage: HTMLElement;

  private engine: SceneEngine;
  private env: StudioEnvironment | null = null;
  private xrAdapter: XRInteractionAdapter | null = null;
  private spatialHud: SpatialHorizonPanel | null = null;
  private voiceController: VoiceCommandController | null = null;
  private spatialAudio: SpatialAudioEngine | null = null;
  private inspector: SceneInspectorPanel;
  private chatPanel: ChatPanel;

  private titleInput: HTMLInputElement;
  private versionTag: HTMLElement;
  private undoBtn: HTMLButtonElement;
  private redoBtn: HTMLButtonElement;
  private voiceBtn: HTMLButtonElement;
  private audioBtn: HTMLButtonElement;
  private spatialHudBtn: HTMLButtonElement;
  private arBtn: HTMLButtonElement;
  private toastEl: HTMLElement;
  private toastTimer: number | null = null;
  private atmoBtns = new Map<AtmospherePreset, HTMLButtonElement>();
  private gridBtn: HTMLButtonElement;
  private gridVisible = true;

  constructor(
    mountEl: HTMLElement,
    engine: SceneEngine,
    inspector: SceneInspectorPanel,
    chatPanel: ChatPanel,
  ) {
    this.engine = engine;
    this.inspector = inspector;
    this.chatPanel = chatPanel;

    this.root = document.createElement('div');
    this.root.className = 'studio-root';

    // Topbar
    const topbar = document.createElement('header');
    topbar.className = 'studio-topbar';

    const left = document.createElement('div');
    left.className = 'topbar-left';

    const mobileLeftBtn = document.createElement('button');
    mobileLeftBtn.type = 'button';
    mobileLeftBtn.className = 'btn mobile-drawer-toggle';
    mobileLeftBtn.textContent = 'Assets';
    mobileLeftBtn.addEventListener('click', () => {
      this.chatPanel.setMobileOpen(false);
      this.inspector.setMobileOpen(
        !this.inspector.element.classList.contains('is-open'),
      );
    });

    const brand = document.createElement('div');
    brand.className = 'brand-mark';
    const cube = document.createElement('span');
    cube.className = 'brand-cube';
    cube.textContent = 'W';
    const brandText = document.createElement('span');
    brandText.className = 'desktop-only-label';
    brandText.textContent = 'WorldCraft AI';
    brand.append(cube, brandText);

    this.titleInput = document.createElement('input');
    this.titleInput.type = 'text';
    this.titleInput.className = 'title-input';
    this.titleInput.value = engine.state.title;
    this.titleInput.setAttribute('aria-label', 'World title');
    this.titleInput.addEventListener('change', () => {
      engine.setTitle(this.titleInput.value);
    });

    this.versionTag = document.createElement('span');
    this.versionTag.className = 'version-tag';
    this.versionTag.textContent = 'v0';

    left.append(mobileLeftBtn, brand, this.titleInput, this.versionTag);

    const right = document.createElement('div');
    right.className = 'topbar-right';

    this.undoBtn = document.createElement('button');
    this.undoBtn.type = 'button';
    this.undoBtn.className = 'btn';
    this.undoBtn.textContent = 'Undo';
    this.undoBtn.addEventListener('click', () => engine.undo());

    this.redoBtn = document.createElement('button');
    this.redoBtn.type = 'button';
    this.redoBtn.className = 'btn';
    this.redoBtn.textContent = 'Redo';
    this.redoBtn.addEventListener('click', () => engine.redo());

    this.voiceBtn = document.createElement('button');
    this.voiceBtn.type = 'button';
    this.voiceBtn.className = 'btn';
    this.voiceBtn.textContent = 'Voice';
    this.voiceBtn.title = 'Speak a spatial voice command (e.g. Add torii gate, Twilight, Undo)';
    this.voiceBtn.addEventListener('click', () => {
      void this.voiceController?.toggleListening();
    });

    this.audioBtn = document.createElement('button');
    this.audioBtn.type = 'button';
    this.audioBtn.className = 'btn btn-active';
    this.audioBtn.textContent = 'Audio On';
    this.audioBtn.setAttribute('aria-label', 'Toggle 3D spatial audio');
    this.audioBtn.setAttribute('aria-pressed', 'true');
    this.audioBtn.title = 'Toggle 3D positional spatial audio (HRTF)';
    this.audioBtn.addEventListener('click', () => {
      if (!this.spatialAudio) return;
      const enabled = this.spatialAudio.toggleEnabled();
      this.showToast(
        enabled ? '3D positional spatial audio enabled' : 'Spatial audio muted',
      );
    });

    this.spatialHudBtn = document.createElement('button');
    this.spatialHudBtn.type = 'button';
    this.spatialHudBtn.className = 'btn';
    this.spatialHudBtn.textContent = 'Spatial HUD';
    this.spatialHudBtn.title = 'Toggle in-world Meta Horizon 3D Spatial UI + XR Inspector';
    this.spatialHudBtn.addEventListener('click', () => {
      if (!this.spatialHud) return;
      const shown = this.spatialHud.toggle();
      this.spatialHudBtn.classList.toggle('btn-active', shown);
      this.showToast(
        shown
          ? 'Horizon 3D Spatial HUD & XR Inspector visible beside stage'
          : 'Horizon 3D Spatial HUD hidden',
      );
    });

    this.arBtn = document.createElement('button');
    this.arBtn.type = 'button';
    this.arBtn.className = 'btn btn-xr';
    this.arBtn.textContent = 'Enter AR';
    this.arBtn.title = 'Launch Meta Quest WebXR AR/VR session';
    this.arBtn.addEventListener('click', () => void this.handleARButton());

    const shareBtn = document.createElement('button');
    shareBtn.type = 'button';
    shareBtn.className = 'btn';
    shareBtn.textContent = 'Share';
    shareBtn.addEventListener('click', () => void this.copyShareUrl());

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'btn';
    exportBtn.textContent = 'JSON';
    exportBtn.addEventListener('click', () => this.exportJson());

    const snapBtn = document.createElement('button');
    snapBtn.type = 'button';
    snapBtn.className = 'btn';
    snapBtn.textContent = 'PNG';
    snapBtn.addEventListener('click', () => this.capturePng());

    const mobileRightBtn = document.createElement('button');
    mobileRightBtn.type = 'button';
    mobileRightBtn.className = 'btn btn-primary mobile-drawer-toggle';
    mobileRightBtn.textContent = 'AI';
    mobileRightBtn.addEventListener('click', () => {
      this.inspector.setMobileOpen(false);
      this.chatPanel.setMobileOpen(
        !this.chatPanel.element.classList.contains('is-open'),
      );
    });

    right.append(
      this.undoBtn,
      this.redoBtn,
      this.voiceBtn,
      this.audioBtn,
      this.spatialHudBtn,
      this.arBtn,
      shareBtn,
      exportBtn,
      snapBtn,
      mobileRightBtn,
    );

    topbar.append(left, right);

    // Workspace
    const workspace = document.createElement('div');
    workspace.className = 'studio-workspace';

    this.viewportStage = document.createElement('main');
    this.viewportStage.className = 'viewport-stage';

    this.toastEl = document.createElement('div');
    this.toastEl.className = 'viewport-toast';

    // Bottom Dock
    const dock = document.createElement('div');
    dock.className = 'viewport-dock';

    for (const [label, preset] of [
      ['Iso', 'iso'],
      ['Top', 'top'],
      ['Front', 'front'],
      ['Reset', 'reset'],
    ] as [string, CameraPreset][]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dock-btn';
      btn.textContent = label;
      btn.addEventListener('click', () => this.env?.setCameraPreset(preset));
      dock.appendChild(btn);
    }

    const div1 = document.createElement('span');
    div1.className = 'dock-divider';
    dock.appendChild(div1);

    for (const [label, atmo] of [
      ['Daylight', 'daylight'],
      ['Golden', 'golden'],
      ['Twilight', 'twilight'],
    ] as [string, AtmospherePreset][]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `dock-btn ${atmo === engine.state.atmosphere ? 'is-active' : ''}`;
      btn.textContent = label;
      btn.addEventListener('click', () => engine.setAtmosphere(atmo));
      this.atmoBtns.set(atmo, btn);
      dock.appendChild(btn);
    }

    const div2 = document.createElement('span');
    div2.className = 'dock-divider';
    dock.appendChild(div2);

    this.gridBtn = document.createElement('button');
    this.gridBtn.type = 'button';
    this.gridBtn.className = 'dock-btn is-active';
    this.gridBtn.textContent = 'Grid';
    this.gridBtn.addEventListener('click', () => {
      this.gridVisible = !this.gridVisible;
      this.gridBtn.classList.toggle('is-active', this.gridVisible);
      this.env?.setGridVisible(this.gridVisible);
    });
    dock.appendChild(this.gridBtn);

    this.viewportStage.append(this.toastEl, dock);
    workspace.append(
      this.inspector.element,
      this.viewportStage,
      this.chatPanel.element,
    );

    this.root.append(topbar, workspace);
    mountEl.appendChild(this.root);

    this.engine.onChange(() => this.syncHeader());
    this.engine.onAtmosphereChange((preset) => this.syncAtmosphereDock(preset));
    this.syncHeader();
  }

  bindRuntime(
    env: StudioEnvironment,
    xrAdapter: XRInteractionAdapter,
    spatialHud: SpatialHorizonPanel,
    voiceController?: VoiceCommandController,
    spatialAudio?: SpatialAudioEngine,
  ): void {
    this.env = env;
    this.xrAdapter = xrAdapter;
    this.spatialHud = spatialHud;
    this.voiceController = voiceController ?? null;
    this.spatialAudio = spatialAudio ?? null;
    if (voiceController) {
      voiceController.onStateChange((state) => this.syncVoiceBtn(state));
    }
    if (spatialAudio) {
      spatialAudio.onStatusChange((status) => this.syncAudioBtn(status));
    }
    xrAdapter.onStatusChange((status) => this.syncXRButton(status));
  }

  private syncAudioBtn(status: AudioStatus): void {
    this.audioBtn.classList.toggle('btn-active', status.enabled);
    this.audioBtn.textContent = status.enabled ? 'Audio On' : 'Muted';
    this.audioBtn.setAttribute('aria-pressed', String(status.enabled));
  }

  private syncVoiceBtn(state: VoiceListenState): void {
    this.voiceBtn.classList.toggle(
      'btn-active',
      state === 'listening' || state === 'transcribing',
    );
    this.voiceBtn.textContent =
      state === 'listening'
        ? 'Listening...'
        : state === 'transcribing'
          ? 'Transcribing...'
          : state === 'executing'
            ? 'Running...'
            : 'Voice';
  }

  private syncXRButton(status: XRStatus): void {
    if (status.inXR) {
      this.arBtn.textContent = 'Exit AR';
      this.arBtn.classList.add('btn-active');
    } else {
      this.arBtn.textContent = 'Enter AR';
      this.arBtn.classList.remove('btn-active');
    }
    this.spatialHudBtn.classList.toggle(
      'btn-active',
      Boolean(this.spatialHud?.isVisible()),
    );
  }

  private async handleARButton(): Promise<void> {
    if (!this.xrAdapter) return;
    if (this.xrAdapter.getStatus().inXR) {
      this.xrAdapter.exitXR();
      return;
    }
    void this.spatialAudio?.unlock();
    const res = await this.xrAdapter.launchAR();
    this.showToast(res.message);
  }

  private syncAtmosphereDock(preset: AtmospherePreset): void {
    for (const [k, btn] of this.atmoBtns.entries()) {
      btn.classList.toggle('is-active', k === preset);
    }
  }

  syncHeader(): void {
    if (document.activeElement !== this.titleInput) {
      this.titleInput.value = this.engine.state.title;
    }
    this.versionTag.textContent = `v${this.engine.state.version}`;
    this.undoBtn.disabled = !this.engine.state.canUndo();
    this.redoBtn.disabled = !this.engine.state.canRedo();
    this.syncAtmosphereDock(this.engine.state.atmosphere);
  }

  showToast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('is-visible');
    if (this.toastTimer !== null) {
      window.clearTimeout(this.toastTimer);
    }
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.classList.remove('is-visible');
    }, 3400);
  }

  private async copyShareUrl(): Promise<void> {
    try {
      await navigator.clipboard.writeText(window.location.href);
      this.showToast('Copied shareable scene URL to clipboard');
    } catch {
      this.showToast(`Share URL: ?scene=${this.engine.state.sessionId}`);
    }
  }

  private exportJson(): void {
    const snap = this.engine.state.toSnapshot();
    const blob = new Blob([JSON.stringify(snap, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${snap.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'worldcraft-scene'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.showToast('Exported scene JSON');
  }

  private capturePng(): void {
    if (!this.env) return;
    const dataUrl = this.env.capturePngDataUrl();
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `worldcraft-v${this.engine.state.version}.png`;
    a.click();
    this.showToast('Captured PNG snapshot');
  }
}
