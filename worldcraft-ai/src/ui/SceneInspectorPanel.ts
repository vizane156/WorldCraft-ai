/**
 * SceneInspectorPanel — left studio drawer with 3 tabs:
 *   - Scene: live object list, selection, XYZ + Rotation Y + Scale + Color Tint inspector
 *   - Catalog: category-filtered 12 spatial assets with 1-click placement
 *   - History: server-persisted version snapshots with 1-click restore
 */

import { getAllAssets, getAsset } from '../catalog/assetCatalog';
import type { SceneEngine } from '../scene/SceneEngine';
import type { SceneObject, SceneState } from '../scene/SceneState';
import type {
  PersistenceClient,
  SceneVersionSummary,
} from '../persistence/PersistenceClient';

export type InspectorTab = 'scene' | 'catalog' | 'history';

const COLOR_SWATCHES = [
  '#ef4444',
  '#f59e0b',
  '#10b981',
  '#38bdf8',
  '#a855f7',
  '#f4efe6',
];

const CATEGORIES = ['All', 'structure', 'prop', 'vehicle', 'nature'];

export interface SceneInspectorCallbacks {
  onPlaceAsset: (assetId: string) => void;
  onSaveScene: (commandLabel: string) => void;
  onRestoreVersion: (version: number) => Promise<void>;
  onToast: (message: string) => void;
}

export class SceneInspectorPanel {
  readonly element: HTMLElement;

  private engine: SceneEngine;
  private state: SceneState;
  private persistence: PersistenceClient;
  private callbacks: SceneInspectorCallbacks;

  private activeTab: InspectorTab = 'scene';
  private activeCategory = 'All';
  private collapsed = false;
  private versions: SceneVersionSummary[] = [];
  private versionsLoading = false;
  private suppressRefresh = false;
  private dragUndoRecorded = false;

  private metaEl: HTMLElement;
  private collapseBtn: HTMLButtonElement;
  private tabButtons = new Map<InspectorTab, HTMLButtonElement>();
  private contentEl: HTMLElement;

  constructor(
    engine: SceneEngine,
    state: SceneState,
    persistence: PersistenceClient,
    callbacks: SceneInspectorCallbacks,
  ) {
    this.engine = engine;
    this.state = state;
    this.persistence = persistence;
    this.callbacks = callbacks;

    this.element = document.createElement('aside');
    this.element.className = 'wc-panel wc-panel-left';
    this.element.setAttribute('aria-label', 'Scene Inspector');

    // Header
    const header = document.createElement('div');
    header.className = 'wc-panel-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'wc-panel-title-wrap';

    const title = document.createElement('h2');
    title.className = 'wc-panel-title';
    title.textContent = 'Scene Studio';

    this.metaEl = document.createElement('div');
    this.metaEl.className = 'wc-panel-meta';
    this.metaEl.dataset.testid = 'scene-meta';

    titleWrap.append(title, this.metaEl);

    this.collapseBtn = document.createElement('button');
    this.collapseBtn.type = 'button';
    this.collapseBtn.className = 'wc-btn';
    this.collapseBtn.textContent = 'Collapse';
    this.collapseBtn.setAttribute('aria-expanded', 'true');
    this.collapseBtn.addEventListener('click', () => this.toggleCollapse());

    header.append(titleWrap, this.collapseBtn);

    // Body
    const body = document.createElement('div');
    body.className = 'wc-panel-body';

    const tabs = document.createElement('div');
    tabs.className = 'wc-tabs';
    tabs.setAttribute('role', 'tablist');

    const tabDefs: Array<{ id: InspectorTab; label: string }> = [
      { id: 'scene', label: 'Scene' },
      { id: 'catalog', label: 'Catalog' },
      { id: 'history', label: 'History' },
    ];

    for (const def of tabDefs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wc-tab';
      btn.textContent = def.label;
      btn.setAttribute('role', 'tab');
      btn.dataset.tab = def.id;
      btn.addEventListener('click', () => this.setTab(def.id));
      tabs.appendChild(btn);
      this.tabButtons.set(def.id, btn);
    }

    this.contentEl = document.createElement('div');
    this.contentEl.className = 'wc-scroll';

    body.append(tabs, this.contentEl);
    this.element.append(header, body);

    this.engine.on('sceneChanged', () => {
      this.updateMeta();
      if (!this.suppressRefresh && this.activeTab === 'scene') {
        this.renderContent();
      }
      if (this.activeTab === 'history') {
        void this.loadVersions();
      }
    });

    this.engine.on('selectionChanged', () => {
      if (!this.suppressRefresh && this.activeTab === 'scene') {
        this.renderContent();
      }
    });

    this.updateMeta();
    this.updateTabStyles();
    this.renderContent();
  }

  setTab(tab: InspectorTab): void {
    this.activeTab = tab;
    this.updateTabStyles();
    if (tab === 'history') {
      void this.loadVersions();
    }
    this.renderContent();
  }

  toggleCollapse(): void {
    this.collapsed = !this.collapsed;
    this.element.classList.toggle('collapsed', this.collapsed);
    this.collapseBtn.textContent = this.collapsed ? 'Expand' : 'Collapse';
    this.collapseBtn.setAttribute('aria-expanded', String(!this.collapsed));
  }

  setMobileVisible(visible: boolean): void {
    this.element.classList.toggle('mobile-hidden', !visible);
  }

  async loadVersions(): Promise<void> {
    this.versionsLoading = true;
    if (this.activeTab === 'history') this.renderContent();
    this.versions = await this.persistence.fetchVersions();
    this.versionsLoading = false;
    if (this.activeTab === 'history') this.renderContent();
  }

  private updateMeta(): void {
    const count = this.state.size;
    const version = this.state.getVersion();
    this.metaEl.textContent = `${count} / 20 objects · v${version}`;
  }

  private updateTabStyles(): void {
    for (const [id, btn] of this.tabButtons) {
      const active = id === this.activeTab;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    }
  }

  private renderContent(): void {
    this.contentEl.replaceChildren();
    if (this.activeTab === 'scene') {
      this.renderSceneTab();
    } else if (this.activeTab === 'catalog') {
      this.renderCatalogTab();
    } else {
      this.renderHistoryTab();
    }
  }

  private renderSceneTab(): void {
    const objects = this.state.getAll();
    const selectedId = this.engine.getSelectedId();

    const topRow = document.createElement('div');
    topRow.className = 'wc-inspector-head';

    const hint = document.createElement('span');
    hint.className = 'wc-catalog-meta';
    hint.textContent =
      objects.length === 0
        ? 'Empty tabletop stage'
        : 'Click object to inspect or drag in 3D';

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'wc-btn wc-btn-danger';
    clearBtn.textContent = 'Clear';
    clearBtn.disabled = objects.length === 0;
    clearBtn.addEventListener('click', () => {
      this.engine.clearSceneManual();
      this.callbacks.onSaveScene('Cleared scene');
      this.callbacks.onToast('Scene cleared');
    });

    topRow.append(hint, clearBtn);
    this.contentEl.appendChild(topRow);

    if (objects.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'wc-empty-note';
      empty.textContent =
        'Describe a world in AI Chat or switch to Catalog to place 3D assets directly on the tabletop.';

      const browseBtn = document.createElement('button');
      browseBtn.type = 'button';
      browseBtn.className = 'wc-btn';
      browseBtn.textContent = 'Browse 12 Assets';
      browseBtn.style.alignSelf = 'center';
      browseBtn.addEventListener('click', () => this.setTab('catalog'));

      this.contentEl.append(empty, browseBtn);
      return;
    }

    const list = document.createElement('div');
    list.className = 'wc-list';

    for (const obj of objects) {
      const row = document.createElement('div');
      row.className = `wc-obj-row${obj.id === selectedId ? ' selected' : ''}`;

      const selectBtn = document.createElement('button');
      selectBtn.type = 'button';
      selectBtn.className = 'wc-obj-select';
      selectBtn.addEventListener('click', () => {
        this.engine.setSelectedId(obj.id);
      });

      const name = document.createElement('span');
      name.className = 'wc-obj-name';
      name.textContent = obj.label;

      const meta = getAsset(obj.asset_id);
      const sub = document.createElement('span');
      sub.className = 'wc-obj-sub';
      const [x, , z] = obj.transform.position;
      sub.textContent = `${meta?.label ?? obj.asset_id} · (${x.toFixed(2)}, ${z.toFixed(2)})`;

      selectBtn.append(name, sub);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'wc-btn wc-icon-btn wc-btn-danger';
      delBtn.textContent = '×';
      delBtn.setAttribute('aria-label', `Remove ${obj.label}`);
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.engine.removeObjectById(obj.id);
        this.callbacks.onSaveScene(`Removed ${obj.label}`);
      });

      row.append(selectBtn, delBtn);
      list.appendChild(row);
    }

    this.contentEl.appendChild(list);

    const selected = selectedId ? this.state.get(selectedId) : undefined;
    if (selected) {
      this.contentEl.appendChild(this.buildTransformInspector(selected));
    }
  }

  private buildTransformInspector(obj: SceneObject): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'wc-inspector';
    wrap.dataset.testid = 'transform-inspector';

    const head = document.createElement('div');
    head.className = 'wc-inspector-head';

    const title = document.createElement('h3');
    title.className = 'wc-inspector-title';
    title.textContent = `Transform · ${obj.label}`;

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '6px';

    const dupBtn = document.createElement('button');
    dupBtn.type = 'button';
    dupBtn.className = 'wc-btn';
    dupBtn.textContent = 'Duplicate';
    dupBtn.addEventListener('click', () => {
      this.engine.duplicateObjectById(obj.id);
      this.callbacks.onSaveScene(`Duplicated ${obj.label}`);
    });

    actions.appendChild(dupBtn);
    head.append(title, actions);
    wrap.appendChild(head);

    // Position X / Y / Z
    const grid = document.createElement('div');
    grid.className = 'wc-field-grid';

    const axes: Array<{ label: string; idx: 0 | 1 | 2; min: number; max: number }> = [
      { label: 'X (m)', idx: 0, min: -0.5, max: 0.5 },
      { label: 'Y (m)', idx: 1, min: 0, max: 0.35 },
      { label: 'Z (m)', idx: 2, min: -0.5, max: 0.5 },
    ];

    for (const axis of axes) {
      const field = document.createElement('div');
      field.className = 'wc-field';

      const id = `wc-pos-${axis.idx}`;
      const lbl = document.createElement('label');
      lbl.htmlFor = id;
      lbl.textContent = axis.label;

      const input = document.createElement('input');
      input.id = id;
      input.type = 'number';
      input.className = 'wc-num-input';
      input.step = '0.02';
      input.min = String(axis.min);
      input.max = String(axis.max);
      input.value = obj.transform.position[axis.idx].toFixed(2);
      input.setAttribute('aria-label', `${obj.label} ${axis.label}`);

      input.addEventListener('change', () => {
        const parsed = parseFloat(input.value);
        if (!Number.isFinite(parsed)) return;
        const nextPos: [number, number, number] = [...obj.transform.position];
        nextPos[axis.idx] = parsed;
        this.engine.updateObjectManual(obj.id, { position: nextPos }, true);
        this.callbacks.onSaveScene(`Moved ${obj.label}`);
      });

      field.append(lbl, input);
      grid.appendChild(field);
    }
    wrap.appendChild(grid);

    // Rotation Y slider
    const rotDeg = Math.round(
      (2 * Math.atan2(obj.transform.rotation[1], obj.transform.rotation[3]) * 180) /
        Math.PI,
    );
    const rotRow = document.createElement('div');
    rotRow.className = 'wc-slider-row';

    const rotLabel = document.createElement('label');
    rotLabel.htmlFor = 'wc-rot-y';
    const rotVal = document.createElement('span');
    rotVal.textContent = `${rotDeg}°`;
    rotLabel.append(document.createTextNode('Rotation Y'), rotVal);

    const rotSlider = document.createElement('input');
    rotSlider.id = 'wc-rot-y';
    rotSlider.type = 'range';
    rotSlider.min = '-180';
    rotSlider.max = '180';
    rotSlider.step = '5';
    rotSlider.value = String(rotDeg);
    rotSlider.setAttribute('aria-label', `${obj.label} Rotation Y`);

    rotSlider.addEventListener('pointerdown', () => {
      this.dragUndoRecorded = false;
    });
    rotSlider.addEventListener('input', () => {
      const deg = Number(rotSlider.value);
      rotVal.textContent = `${deg}°`;
      this.suppressRefresh = true;
      const shouldRecordUndo = !this.dragUndoRecorded;
      this.dragUndoRecorded = true;
      this.engine.updateObjectManual(obj.id, { rotationYDeg: deg }, shouldRecordUndo);
      this.suppressRefresh = false;
    });
    rotSlider.addEventListener('change', () => {
      const deg = Number(rotSlider.value);
      const shouldRecordUndo = !this.dragUndoRecorded;
      this.dragUndoRecorded = false;
      this.engine.updateObjectManual(obj.id, { rotationYDeg: deg }, shouldRecordUndo);
      this.callbacks.onSaveScene(`Rotated ${obj.label}`);
    });

    rotRow.append(rotLabel, rotSlider);
    wrap.appendChild(rotRow);

    // Scale slider
    const assetMeta = getAsset(obj.asset_id);
    const minScale = assetMeta?.min_scale ?? 0.3;
    const maxScale = assetMeta?.max_scale ?? 2.5;
    const currentScale = obj.transform.scale[0];

    const scaleRow = document.createElement('div');
    scaleRow.className = 'wc-slider-row';

    const scaleLabel = document.createElement('label');
    scaleLabel.htmlFor = 'wc-scale';
    const scaleVal = document.createElement('span');
    scaleVal.textContent = `${currentScale.toFixed(2)}×`;
    scaleLabel.append(document.createTextNode('Scale'), scaleVal);

    const scaleSlider = document.createElement('input');
    scaleSlider.id = 'wc-scale';
    scaleSlider.type = 'range';
    scaleSlider.min = String(minScale);
    scaleSlider.max = String(maxScale);
    scaleSlider.step = '0.05';
    scaleSlider.value = String(currentScale);
    scaleSlider.setAttribute('aria-label', `${obj.label} Scale`);

    scaleSlider.addEventListener('pointerdown', () => {
      this.dragUndoRecorded = false;
    });
    scaleSlider.addEventListener('input', () => {
      const s = Number(scaleSlider.value);
      scaleVal.textContent = `${s.toFixed(2)}×`;
      this.suppressRefresh = true;
      const shouldRecordUndo = !this.dragUndoRecorded;
      this.dragUndoRecorded = true;
      this.engine.updateObjectManual(obj.id, { scale: s }, shouldRecordUndo);
      this.suppressRefresh = false;
    });
    scaleSlider.addEventListener('change', () => {
      const s = Number(scaleSlider.value);
      const shouldRecordUndo = !this.dragUndoRecorded;
      this.dragUndoRecorded = false;
      this.engine.updateObjectManual(obj.id, { scale: s }, shouldRecordUndo);
      this.callbacks.onSaveScene(`Scaled ${obj.label}`);
    });

    scaleRow.append(scaleLabel, scaleSlider);
    wrap.appendChild(scaleRow);

    // Accent color tint
    const colorRow = document.createElement('div');
    colorRow.className = 'wc-slider-row';

    const colorLbl = document.createElement('label');
    colorLbl.textContent = 'Accent Color';
    const colorCode = document.createElement('span');
    colorCode.textContent = obj.color ?? 'Default';
    colorLbl.appendChild(colorCode);

    const swatches = document.createElement('div');
    swatches.className = 'wc-swatches';

    for (const hex of COLOR_SWATCHES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `wc-swatch${obj.color?.toLowerCase() === hex ? ' active' : ''}`;
      btn.style.backgroundColor = hex;
      btn.setAttribute('aria-label', `Tint ${obj.label} ${hex}`);
      btn.addEventListener('click', () => {
        this.engine.updateObjectManual(obj.id, { color: hex }, true);
        this.callbacks.onSaveScene(`Recolored ${obj.label}`);
      });
      swatches.appendChild(btn);
    }

    const customPicker = document.createElement('input');
    customPicker.type = 'color';
    customPicker.value = obj.color ?? '#6366f1';
    customPicker.setAttribute('aria-label', `Custom color for ${obj.label}`);
    customPicker.style.width = '28px';
    customPicker.style.height = '22px';
    customPicker.style.border = 'none';
    customPicker.style.background = 'transparent';
    customPicker.style.cursor = 'pointer';
    customPicker.addEventListener('change', () => {
      this.engine.updateObjectManual(obj.id, { color: customPicker.value }, true);
      this.callbacks.onSaveScene(`Recolored ${obj.label}`);
    });
    swatches.appendChild(customPicker);

    colorRow.append(colorLbl, swatches);
    wrap.appendChild(colorRow);

    return wrap;
  }

  private renderCatalogTab(): void {
    const filters = document.createElement('div');
    filters.className = 'wc-cat-filters';

    for (const cat of CATEGORIES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `wc-seg-btn${this.activeCategory === cat ? ' active' : ''}`;
      btn.textContent = cat === 'All' ? 'All' : cat.charAt(0).toUpperCase() + cat.slice(1);
      btn.addEventListener('click', () => {
        this.activeCategory = cat;
        this.renderContent();
      });
      filters.appendChild(btn);
    }

    this.contentEl.appendChild(filters);

    const list = document.createElement('div');
    list.className = 'wc-list';

    const assets = getAllAssets().filter(
      (a) => this.activeCategory === 'All' || a.category === this.activeCategory,
    );

    for (const asset of assets) {
      const card = document.createElement('div');
      card.className = 'wc-catalog-card';

      const info = document.createElement('div');
      info.className = 'wc-catalog-info';

      const label = document.createElement('span');
      label.className = 'wc-catalog-label';
      label.textContent = asset.label;

      const meta = document.createElement('span');
      meta.className = 'wc-catalog-meta';
      meta.textContent = `${asset.category} · ${asset.tags.slice(0, 3).join(', ')}`;

      info.append(label, meta);

      const placeBtn = document.createElement('button');
      placeBtn.type = 'button';
      placeBtn.className = 'wc-btn wc-btn-primary';
      placeBtn.textContent = 'Place';
      placeBtn.dataset.placeAsset = asset.id;
      placeBtn.disabled = this.state.size >= 20;
      placeBtn.addEventListener('click', () => {
        this.callbacks.onPlaceAsset(asset.id);
      });

      card.append(info, placeBtn);
      list.appendChild(card);
    }

    this.contentEl.appendChild(list);
  }

  private renderHistoryTab(): void {
    const head = document.createElement('div');
    head.className = 'wc-inspector-head';

    const desc = document.createElement('span');
    desc.className = 'wc-catalog-meta';
    desc.textContent = 'Saved scene revisions';

    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'wc-btn';
    refreshBtn.textContent = 'Refresh';
    refreshBtn.addEventListener('click', () => {
      void this.loadVersions();
    });

    head.append(desc, refreshBtn);
    this.contentEl.appendChild(head);

    if (this.versionsLoading) {
      const note = document.createElement('div');
      note.className = 'wc-empty-note';
      note.textContent = 'Loading version history...';
      this.contentEl.appendChild(note);
      return;
    }

    if (this.versions.length === 0) {
      const note = document.createElement('div');
      note.className = 'wc-empty-note';
      note.textContent =
        'No saved versions yet. Place an asset or run an AI command to create your first revision.';
      this.contentEl.appendChild(note);
      return;
    }

    const list = document.createElement('div');
    list.className = 'wc-list';

    for (const v of this.versions) {
      const row = document.createElement('div');
      row.className = 'wc-version-row';

      const info = document.createElement('div');
      info.className = 'wc-catalog-info';

      const title = document.createElement('span');
      title.className = 'wc-obj-name';
      title.textContent = `v${v.version} · ${v.command || 'Scene update'}`;

      const atmoLabel =
        v.atmosphere === 'golden_hour'
          ? 'Golden'
          : v.atmosphere === 'twilight_lanterns'
            ? 'Twilight'
            : 'Daylight';
      const timeStr = new Date(v.created_at).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      const sub = document.createElement('span');
      sub.className = 'wc-obj-sub';
      sub.textContent = `${v.object_count} obj · ${atmoLabel} · ${timeStr}`;

      info.append(title, sub);

      const restoreBtn = document.createElement('button');
      restoreBtn.type = 'button';
      restoreBtn.className = 'wc-btn';
      restoreBtn.textContent = 'Restore';
      restoreBtn.dataset.restoreVersion = String(v.version);
      restoreBtn.addEventListener('click', () => {
        void this.callbacks.onRestoreVersion(v.version);
      });

      row.append(info, restoreBtn);
      list.appendChild(row);
    }

    this.contentEl.appendChild(list);
  }
}
