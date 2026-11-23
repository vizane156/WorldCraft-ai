import test from 'node:test';
import assert from 'node:assert/strict';
import { BoundaryGuard } from './BoundaryGuard';
import { SceneState } from './SceneState';

test('BoundaryGuard clamps XZ position to radius and grounds Y', () => {
  const guard = new BoundaryGuard();
  const clamped = guard.clampPosition([1.0, -0.5, 0.0], 0.5);
  assert.equal(clamped[0], 0.5);
  assert.equal(clamped[1], 0);
  assert.equal(clamped[2], 0);

  const inside = guard.clampPosition([0.2, 0.15, -0.2], 0.5);
  assert.deepEqual(inside, [0.2, 0.15, -0.2]);
});

test('BoundaryGuard clamps uniform scale within asset bounds', () => {
  const guard = new BoundaryGuard();
  assert.equal(guard.clampScale(0.05, 0.3, 2.0), 0.3);
  assert.equal(guard.clampScale(8.0, 0.3, 2.0), 2.0);
  assert.equal(guard.clampScale(1.25, 0.3, 2.0), 1.25);
});

test('SceneState supports add, case-insensitive resolve, unique labels, and undo/redo', () => {
  const state = new SceneState();
  state.pushUndoSnapshot();
  state.add({
    id: 'obj-1',
    asset_id: 'fountain_stone',
    label: 'Stone_Fountain',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
  });
  state.bumpVersion();

  assert.equal(state.size, 1);
  assert.equal(state.resolve('stone_fountain')?.id, 'obj-1');
  assert.equal(state.resolve('fountain')?.id, 'obj-1');
  assert.equal(state.generateUniqueLabel('stone_fountain'), 'stone_fountain_2');

  const prev = state.popUndo();
  assert.ok(prev);
  if (!prev) throw new Error('Expected undo snapshot');
  assert.equal(prev.objects.length, 0);
  state.deserialize(prev);
  assert.equal(state.size, 0);

  const redone = state.popRedo();
  assert.ok(redone);
  if (!redone) throw new Error('Expected redo snapshot');
  assert.equal(redone.objects.length, 1);
  state.deserialize(redone);
  assert.equal(state.size, 1);
});

test('SceneState serializes and deserializes atmosphere and origin', () => {
  const state = new SceneState();
  state.setAtmosphere('twilight_lanterns');
  state.setOrigin({
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
  });
  const snap = state.serialize();
  const restored = new SceneState();
  restored.deserialize(snap);
  assert.equal(restored.getAtmosphere(), 'twilight_lanterns');
  assert.deepEqual(restored.getOrigin()?.position, [0, 0, 0]);
});
