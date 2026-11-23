import { getAllAssets, getAsset } from '../catalog/assetCatalog';
import type { XRStatus } from '../interaction/XRInteractionAdapter';
import type { PersistedSceneVersion } from '../persistence/PersistenceClient';
import { SceneEngine } from '../scene/SceneEngine';
import type { SceneObjectData } from '../scene/SceneState';

type InspectorTab = 'catalog' | 'scene' | 'history';

export interface InspectorCallbacks {
  onLoadVersions: () => Promise<PersistedSceneVersion[]>;
  onRestoreVersion: (versionNumber: number) => Promise<void>;
  onFocusObject?: (obj: SceneObjectData) => void;
  onCloseMobile?: () => void;
  onGetXRStatus?: () => XRStatus;
  onReAnchorXR?: () => void;
  onGetAudioInfo?: (
    id: string,
  ) => { label: string; distanceM: number | null; enabled: boolean } | null;
}

export class SceneInspectorPanel {
  readonly element: HTMLElement;

  private engine: SceneEngine;
  private callbacks: InspectorCallbacks;
  private activeTab: InspectorTab = 'catalog';
  private activeCategory = 'All';
  private versions: PersistedSceneVersion[] = [];
  private versionsLoading = false;

  private bodyEl: HTMLElement;
  private tabButtons = new Map<InspectorTab, HTMLButtonElement>();

  constructor(engine: SceneEngine, callbacks: InspectorCallbacks) {
    this.engine = engine;
    this.callbacks = callbacks;

    this.element = document.createElement('aside');
    this.element.className = 'drawer drawer-left';
    this.element.setAttribute('aria-label', 'World Inspector & Asset Catalog');

    const tabBar = document.createElement('div');
    tabBar.className = 'drawer-tabs';

    const tabs: Array<[InspectorTab, string]> = [
      ['catalog', 'Assets (20)'],
      ['scene', 'Scene'],
      ['history', 'History'],
    ];

    for (const [key, label] of tabs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `drawer-tab ${key === this.activeTab ? 'is-active' : ''}`;
      btn.textContent = label;
      btn.addEventListener('click', () => {
        void this.setTab(key);
      });
      this.tabButtons.set(key, btn);
      tabBar.appendChild(btn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn drawer-close-mobile';
    closeBtn.textContent = 'Close';
    closeBtn.style.marginBottom = '4px';
    closeBtn.addEventListener('click', () => this.callbacks.onCloseMobile?.());
    tabBar.appendChild(closeBtn);

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'drawer-body';

    this.element.append(tabBar, this.bodyEl);

    this.engine.onChange(() => {
      if (this.activeTab === 'scene') {
        this.renderSceneTab();
      } else if (this.activeTab === 'history') {
        void this.refreshHistory();
      }
      this.updateSceneTabCount();
    });

    this.engine.onSelectionChange(() => {
      if (this.activeTab === 'scene') {
        this.renderSceneTab();
      }
    });

    this.render();
  }

  private updateSceneTabCount(): void {
    const sceneBtn = this.tabButtons.get('scene');
    if (sceneBtn) {
      sceneBtn.textContent = `Scene (${this.engine.state.getCount()})`;
    }
  }

  async setTab(tab: InspectorTab): Promise<void> {
    this.activeTab = tab;
    for (const [k, btn] of this.tabButtons.entries()) {
      btn.classList.toggle('is-active', k === tab);
    }
    if (tab === 'history') {
      await this.refreshHistory();
    } else {
      this.render();
    }
  }

  async refreshHistory(): Promise<void> {
    this.versionsLoading = true;
    this.render();
    try {
      this.versions = await this.callbacks.onLoadVersions();
    } catch {
      this.versions = [];
    } finally {
      this.versionsLoading = false;
      if (this.activeTab === 'history') {
        this.render();
      }
    }
  }

  setMobileOpen(open: boolean): void {
    this.element.classList.toggle('is-open', open);
  }

  private render(): void {
    this.updateSceneTabCount();
    if (this.activeTab === 'catalog') {
      this.renderCatalogTab();
    } else if (this.activeTab === 'scene') {
      this.renderSceneTab();
    } else {
      this.renderHistoryTab();
    }
  }

  private renderCatalogTab(): void {
    this.bodyEl.innerHTML = '';

    const categories = [
      'All',
      'Japanese & Zen',
      'Urban & Medieval',
      'Sci-Fi & Future',
      'Nature & Vehicles',
    ];

    const filterRow = document.createElement('div');
    filterRow.className = 'filter-row';
    for (const cat of categories) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `filter-chip ${cat === this.activeCategory ? 'is-active' : ''}`;
      chip.textContent = cat;
      chip.addEventListener('click', () => {
        this.activeCategory = cat;
        this.renderCatalogTab();
      });
      filterRow.appendChild(chip);
    }
    this.bodyEl.appendChild(filterRow);

    const grid = document.createElement('div');
    grid.className = 'catalog-grid';

    const assets = getAllAssets().filter(
      (a) => this.activeCategory === 'All' || a.category === this.activeCategory,
    );

    for (const asset of assets) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'asset-card';
      card.title = asset.summary;
      card.dataset.assetId = asset.id;

      const swatch = document.createElement('span');
      swatch.className = 'asset-swatch';
      swatch.style.backgroundColor = asset.defaultColor;

      const meta = document.createElement('div');
      meta.className = 'asset-meta';

      const name = document.createElement('div');
      name.className = 'asset-name';
      name.textContent = asset.name;

      const sub = document.createElement('div');
      sub.className = 'asset-sub';
      sub.textContent = `${asset.category} · ${asset.boundingRadius.toFixed(1)}m`;

      meta.append(name, sub);

      const addLabel = document.createElement('span');
      addLabel.className = 'btn';
      addLabel.textContent = '+ Add';

      card.append(swatch, meta, addLabel);
      card.addEventListener('click', () => {
        this.engine.spawnManual(asset.id);
      });
      grid.appendChild(card);
    }

    this.bodyEl.appendChild(grid);
  }

  private renderSceneTab(): void {
    this.bodyEl.innerHTML = '';

    const items = this.engine.state.getAllObjects();
    const selectedId = this.engine.getSelectedId();
    const selected = selectedId ? this.engine.state.getObject(selectedId) : undefined;

    const xrStatus = this.callbacks.onGetXRStatus?.();
    if (xrStatus) {
      const xrCard = document.createElement('div');
      xrCard.className = 'inspector-card';
      const xrHead = document.createElement('div');
      xrHead.style.display = 'flex';
      xrHead.style.justifyContent = 'space-between';
      xrHead.style.alignItems = 'center';

      const xrTitle = document.createElement('span');
      xrTitle.className = 'section-label';
      xrTitle.textContent = 'XR Inspector';

      const xrMode = document.createElement('span');
      xrMode.style.fontFamily = 'var(--font-mono)';
      xrMode.style.fontSize = '11px';
      xrMode.style.color = xrStatus.inXR ? '#22d3ee' : '#94a3b8';
      xrMode.textContent = xrStatus.inXR
        ? xrStatus.surfaceAnchored
          ? 'AR Anchored (0.18x)'
          : 'AR Hit-Test Active'
        : xrStatus.supported
          ? 'Quest WebXR Ready'
          : '3D Studio (Inline)';
      xrHead.append(xrTitle, xrMode);

      const xrSub = document.createElement('div');
      xrSub.style.fontSize = '11px';
      xrSub.style.color = '#94a3b8';
      xrSub.textContent = selected
        ? `Entity: ${selected.label} · DistanceGrabbable (Move/Rotate/Scale)`
        : 'All objects wrap IWSDK RayInteractable + DistanceGrabbable.';

      xrCard.append(xrHead, xrSub);

      const audioInfo = selected ? this.callbacks.onGetAudioInfo?.(selected.id) : null;
      const audioLine = document.createElement('div');
      audioLine.style.fontFamily = 'var(--font-mono)';
      audioLine.style.fontSize = '10px';
      audioLine.style.color = audioInfo && !audioInfo.enabled ? '#fca5a5' : '#67e8f9';
      if (audioInfo) {
        audioLine.textContent = audioInfo.enabled
          ? `Audio: ${audioInfo.label} · HRTF 3D · ${audioInfo.distanceM !== null ? `${audioInfo.distanceM.toFixed(2)}m` : 'Active'}`
          : `Audio: ${audioInfo.label} · Muted`;
      } else {
        audioLine.textContent = `Audio: ${xrStatus.inXR ? 'HRTF 3D AR Tabletop' : 'HRTF 3D Positional'} · Select object for distance`;
      }
      xrCard.appendChild(audioLine);

      if (xrStatus.inXR && this.callbacks.onReAnchorXR) {
        const reBtn = document.createElement('button');
        reBtn.type = 'button';
        reBtn.className = 'btn';
        reBtn.textContent = 'Re-Anchor Tabletop';
        reBtn.addEventListener('click', () => this.callbacks.onReAnchorXR?.());
        xrCard.appendChild(reBtn);
      }
      this.bodyEl.appendChild(xrCard);
    }

    if (selected) {
      const card = document.createElement('div');
      card.className = 'inspector-card';

      const header = document.createElement('div');
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.alignItems = 'center';
      header.style.gap = '6px';

      const title = document.createElement('span');
      title.className = 'section-label';
      title.textContent = 'Transform Inspector';
      header.appendChild(title);

      const assetDef = getAsset(selected.asset_id);
      if (assetDef) {
        const typeSpan = document.createElement('span');
        typeSpan.style.fontSize = '11px';
        typeSpan.style.color = '#94a3b8';
        typeSpan.textContent = `${assetDef.category} · r=${(assetDef.boundingRadius * selected.scale).toFixed(2)}m`;
        header.appendChild(typeSpan);
      }
      card.appendChild(header);

      const labelGroup = document.createElement('div');
      labelGroup.className = 'field-group';
      const labelLbl = document.createElement('label');
      labelLbl.textContent = 'Label';
      const labelInput = document.createElement('input');
      labelInput.className = 'text-input';
      labelInput.value = selected.label;
      labelInput.addEventListener('change', () => {
        this.engine.updateObjectTransform(selected.id, { label: labelInput.value });
      });
      labelGroup.append(labelLbl, labelInput);
      card.appendChild(labelGroup);

      const coordGrid = document.createElement('div');
      coordGrid.className = 'coord-grid';
      const axes: Array<['X', 0] | ['Y', 1] | ['Z', 2]> = [
        ['X', 0],
        ['Y', 1],
        ['Z', 2],
      ];
      for (const [axisName, idx] of axes) {
        const fg = document.createElement('div');
        fg.className = 'field-group';
        const lbl = document.createElement('label');
        lbl.textContent = `Pos ${axisName}`;
        const input = document.createElement('input');
        input.type = 'number';
        input.step = '0.25';
        input.className = 'num-input';
        input.value = String(selected.position[idx]);
        input.addEventListener('change', () => {
          const val = Number.parseFloat(input.value);
          if (!Number.isFinite(val)) return;
          const nextPos: [number, number, number] = [...selected.position];
          nextPos[idx] = val;
          this.engine.updateObjectTransform(selected.id, { position: nextPos });
        });
        fg.append(lbl, input);
        coordGrid.appendChild(fg);
      }
      card.appendChild(coordGrid);

      // Rotation Y slider
      const rotGroup = document.createElement('div');
      rotGroup.className = 'field-group';
      const rotLbl = document.createElement('label');
      rotLbl.textContent = 'Rotation Y (deg)';
      const rotRow = document.createElement('div');
      rotRow.className = 'range-row';
      const rotRange = document.createElement('input');
      rotRange.type = 'range';
      rotRange.min = '-180';
      rotRange.max = '180';
      rotRange.step = '5';
      const deg = Math.round((selected.rotation_y * 180) / Math.PI);
      rotRange.value = String(deg);
      const rotVal = document.createElement('span');
      rotVal.className = 'range-val';
      rotVal.textContent = `${deg}°`;
      rotRange.addEventListener('input', () => {
        const d = Number.parseFloat(rotRange.value);
        rotVal.textContent = `${d}°`;
        this.engine.updateObjectTransform(
          selected.id,
          { rotation_y: (d * Math.PI) / 180 },
          false,
          false,
        );
      });
      rotRange.addEventListener('change', () => {
        const d = Number.parseFloat(rotRange.value);
        this.engine.updateObjectTransform(
          selected.id,
          { rotation_y: (d * Math.PI) / 180 },
          true,
          true,
        );
      });
      rotRow.append(rotRange, rotVal);
      rotGroup.append(rotLbl, rotRow);
      card.appendChild(rotGroup);

      // Scale slider
      const scaleGroup = document.createElement('div');
      scaleGroup.className = 'field-group';
      const scaleLbl = document.createElement('label');
      scaleLbl.textContent = 'Uniform Scale';
      const scaleRow = document.createElement('div');
      scaleRow.className = 'range-row';
      const scaleRange = document.createElement('input');
      scaleRange.type = 'range';
      scaleRange.min = '0.25';
      scaleRange.max = '3.0';
      scaleRange.step = '0.05';
      scaleRange.value = String(selected.scale);
      const scaleVal = document.createElement('span');
      scaleVal.className = 'range-val';
      scaleVal.textContent = `${selected.scale.toFixed(2)}x`;
      scaleRange.addEventListener('input', () => {
        const s = Number.parseFloat(scaleRange.value);
        scaleVal.textContent = `${s.toFixed(2)}x`;
        this.engine.updateObjectTransform(selected.id, { scale: s }, false, false);
      });
      scaleRange.addEventListener('change', () => {
        const s = Number.parseFloat(scaleRange.value);
        this.engine.updateObjectTransform(selected.id, { scale: s }, true, true);
      });
      scaleRow.append(scaleRange, scaleVal);
      scaleGroup.append(scaleLbl, scaleRow);
      card.appendChild(scaleGroup);

      // Color + actions
      const bottomRow = document.createElement('div');
      bottomRow.style.display = 'flex';
      bottomRow.style.alignItems = 'center';
      bottomRow.style.justifyContent = 'space-between';
      bottomRow.style.gap = '6px';

      const colorWrap = document.createElement('label');
      colorWrap.style.display = 'flex';
      colorWrap.style.alignItems = 'center';
      colorWrap.style.gap = '6px';
      colorWrap.style.fontSize = '11px';
      colorWrap.textContent = 'Accent';
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = selected.color;
      colorInput.addEventListener('change', () => {
        this.engine.updateObjectTransform(selected.id, { color: colorInput.value });
      });
      colorWrap.prepend(colorInput);

      const actionBtns = document.createElement('div');
      actionBtns.style.display = 'flex';
      actionBtns.style.gap = '6px';

      const dupBtn = document.createElement('button');
      dupBtn.type = 'button';
      dupBtn.className = 'btn';
      dupBtn.textContent = 'Duplicate';
      dupBtn.addEventListener('click', () => this.engine.duplicateObject(selected.id));

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn-danger';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => this.engine.deleteObject(selected.id));

      actionBtns.append(dupBtn, delBtn);
      bottomRow.append(colorWrap, actionBtns);
      card.appendChild(bottomRow);

      this.bodyEl.appendChild(card);
    }

    const outlinerHeader = document.createElement('div');
    outlinerHeader.style.display = 'flex';
    outlinerHeader.style.justifyContent = 'space-between';
    outlinerHeader.style.alignItems = 'center';

    const outTitle = document.createElement('span');
    outTitle.className = 'section-label';
    outTitle.textContent = `Scene Outliner (${items.length}/60)`;
    outlinerHeader.appendChild(outTitle);

    if (items.length > 0) {
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'btn btn-danger';
      clearBtn.textContent = 'Clear';
      clearBtn.addEventListener('click', () => this.engine.clearScene());
      outlinerHeader.appendChild(clearBtn);
    }
    this.bodyEl.appendChild(outlinerHeader);

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.style.fontSize = '12px';
      empty.style.color = '#64748b';
      empty.textContent =
        'No objects yet. Add assets from the Catalog tab or prompt the AI Director.';
      this.bodyEl.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'outliner-list';
    for (const item of items) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `outliner-item ${item.id === selectedId ? 'is-selected' : ''}`;

      const nameSpan = document.createElement('span');
      nameSpan.textContent = item.label;

      const posSpan = document.createElement('span');
      posSpan.style.fontFamily = 'var(--font-mono)';
      posSpan.style.fontSize = '10px';
      posSpan.style.color = '#94a3b8';
      posSpan.textContent = `${item.position[0].toFixed(1)}, ${item.position[2].toFixed(1)}`;

      row.append(nameSpan, posSpan);
      row.addEventListener('click', () => {
        this.engine.setSelectedId(item.id);
        this.callbacks.onFocusObject?.(item);
      });
      list.appendChild(row);
    }
    this.bodyEl.appendChild(list);
  }

  private renderHistoryTab(): void {
    this.bodyEl.innerHTML = '';

    const topRow = document.createElement('div');
    topRow.style.display = 'flex';
    topRow.style.justifyContent = 'space-between';
    topRow.style.alignItems = 'center';

    const lbl = document.createElement('span');
    lbl.className = 'section-label';
    lbl.textContent = 'Saved Cloud Versions';

    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'btn';
    refreshBtn.textContent = 'Refresh';
    refreshBtn.addEventListener('click', () => void this.refreshHistory());

    topRow.append(lbl, refreshBtn);
    this.bodyEl.appendChild(topRow);

    if (this.versionsLoading) {
      const loading = document.createElement('div');
      loading.style.fontSize = '12px';
      loading.style.color = '#94a3b8';
      loading.textContent = 'Loading version history...';
      this.bodyEl.appendChild(loading);
      return;
    }

    if (this.versions.length === 0) {
      const empty = document.createElement('div');
      empty.style.fontSize = '12px';
      empty.style.color = '#64748b';
      empty.textContent =
        'No saved snapshots yet. Any scene edit or AI build creates an immutable version.';
      this.bodyEl.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'outliner-list';
    for (const v of this.versions) {
      const card = document.createElement('div');
      card.className = 'outliner-item';
      card.style.cursor = 'default';

      const info = document.createElement('div');
      info.style.minWidth = '0';

      const line1 = document.createElement('div');
      line1.style.fontWeight = '600';
      line1.textContent = `v${v.version} · ${v.object_count} objects (${v.atmosphere})`;

      const line2 = document.createElement('div');
      line2.style.fontSize = '11px';
      line2.style.color = '#94a3b8';
      const time = new Date(v.created_at).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      line2.textContent = v.note ? `${v.note} · ${time}` : time;

      info.append(line1, line2);

      const restoreBtn = document.createElement('button');
      restoreBtn.type = 'button';
      restoreBtn.className = 'btn';
      restoreBtn.textContent = 'Restore';
      restoreBtn.addEventListener('click', () => {
        void this.callbacks.onRestoreVersion(v.version);
      });

      card.append(info, restoreBtn);
      list.appendChild(card);
    }
    this.bodyEl.appendChild(list);
  }
}
