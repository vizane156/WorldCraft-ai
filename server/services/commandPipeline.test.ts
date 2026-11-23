import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getAllAssets } from '../catalog/assetCatalog.ts';
import { parseGeminiErrorMessage } from './aiGateway.ts';
import { validateCommandBatch } from './commandValidator.ts';

describe('Asset catalog & command validator', () => {
  it('exposes 20 multi-theme catalog assets', () => {
    const assets = getAllAssets();
    assert.equal(assets.length, 20);
    const themes = new Set(assets.map((a) => a.theme));
    assert.ok(themes.has('japanese'));
    assert.ok(themes.has('urban'));
    assert.ok(themes.has('medieval'));
    assert.ok(themes.has('scifi'));
    assert.ok(themes.has('vehicles'));
    assert.ok(themes.has('nature'));
  });

  it('validates and clamps out-of-bounds spawn coordinates', () => {
    const result = validateCommandBatch(
      {
        version: '1.0',
        assistantMessage: 'Added watchtower.',
        atmosphere: 'golden',
        commands: [
          {
            action: 'spawn',
            asset_id: 'medieval_tower',
            position: [9.8, 0, 9.8],
            scale: 1.0,
          },
          {
            action: 'spawn',
            asset_id: 'non_existent_prop',
            position: [0, 0, 0],
          },
        ],
      },
      [],
    );

    assert.equal(result.valid, true);
    assert.equal(result.batch.commands.length, 1);
    const cmd = result.batch.commands[0];
    assert.equal(cmd.action, 'spawn');
    if (cmd.action === 'spawn') {
      const dist = Math.hypot(cmd.position[0], cmd.position[2]);
      assert.ok(dist <= 7.3, `expected clamped radius <= 7.3, got ${dist}`);
    }
    assert.equal(result.warnings.length, 2);
  });

  it('rejects malformed command batches without crashing', () => {
    const result = validateCommandBatch({ bad: true }, []);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
  });

  it('extracts clean upstream Gemini error strings', () => {
    const raw =
      'Error: {"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}';
    const parsed = parseGeminiErrorMessage(new Error(raw));
    assert.equal(parsed.status, 503);
    assert.equal(parsed.code, 'AI_UNAVAILABLE');
    assert.match(parsed.message, /high demand/i);
  });
});
