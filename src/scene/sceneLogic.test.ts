import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getAllAssets } from '../catalog/assetCatalog.ts';
import { BoundaryGuard } from './BoundaryGuard.ts';
import { SceneState } from './SceneState.ts';

describe('SceneState & BoundaryGuard', () => {
  it('clamps out-of-bounds radial coordinates while preserving direction', () => {
    const guard = new BoundaryGuard(9.0, 60);
    const clamped = guard.clampPosition([12, -2, 0], 1.5, 1.0);
    assert.deepEqual(clamped, [7.5, 0, 0]);
  });

  it('normalizes scale and Y rotation cleanly', () => {
    const guard = new BoundaryGuard();
    assert.equal(guard.clampScale(10), 3.0);
    assert.equal(guard.clampScale(0.01), 0.25);
    assert.ok(Math.abs(guard.normalizeRotationY(Math.PI * 3) - Math.PI) < 0.01);
  });

  it('supports undo and redo across object edits and atmosphere switches', () => {
    const state = new SceneState('test-session');
    state.checkpoint();
    state.atmosphere = 'golden';
    state.upsertObject({
      id: 'obj-1',
      asset_id: 'torii_gate',
      label: 'Vermilion Torii Gate',
      position: [0, 0, 0],
      rotation_y: 0,
      scale: 1,
      color: '#D13B2B',
    });

    assert.equal(state.getCount(), 1);
    assert.equal(state.canUndo(), true);

    state.undo();
    assert.equal(state.getCount(), 0);
    assert.equal(state.atmosphere, 'daylight');
    assert.equal(state.canRedo(), true);

    state.redo();
    assert.equal(state.getCount(), 1);
    assert.equal(state.atmosphere, 'golden');
  });

  it('exposes 20 unique multi-theme catalog assets', () => {
    const assets = getAllAssets();
    assert.equal(assets.length, 20);
    const uniqueIds = new Set(assets.map((a) => a.id));
    assert.equal(uniqueIds.size, 20);
  });
});
