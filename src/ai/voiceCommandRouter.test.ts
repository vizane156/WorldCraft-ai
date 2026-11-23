import assert from 'node:assert/strict';
import test from 'node:test';
import { parseVoiceCommand } from './voiceCommandRouter';

test('VoiceCommandRouter', async (t) => {
  await t.test('parses instant spatial and XR actions in English and French', () => {
    assert.deepEqual(parseVoiceCommand('undo'), { type: 'undo' });
    assert.deepEqual(parseVoiceCommand('annuler'), { type: 'undo' });
    assert.deepEqual(parseVoiceCommand('redo'), { type: 'redo' });
    assert.deepEqual(parseVoiceCommand('rotate left'), {
      type: 'rotate_selected',
      deltaRad: Math.PI / 4,
    });
    assert.deepEqual(parseVoiceCommand('bigger'), {
      type: 'scale_selected',
      factor: 1.25,
    });
    assert.deepEqual(parseVoiceCommand('next object'), {
      type: 'select_cycle',
      dir: 1,
    });
    assert.deepEqual(parseVoiceCommand('re-anchor'), { type: 'reanchor' });
    assert.deepEqual(parseVoiceCommand('twilight'), {
      type: 'atmosphere',
      preset: 'twilight',
    });
    assert.deepEqual(parseVoiceCommand('show hud'), {
      type: 'toggle_hud',
      visible: true,
    });
  });

  await t.test('parses direct single-asset voice spawns from catalog', () => {
    assert.deepEqual(parseVoiceCommand('add torii gate'), {
      type: 'spawn',
      assetId: 'torii_gate',
      assetName: 'Vermilion Torii Gate',
    });
    assert.deepEqual(parseVoiceCommand('ajoute un rover'), {
      type: 'spawn',
      assetId: 'hover_rover',
      assetName: 'Orbital Hover Rover',
    });
  });

  await t.test('routes complex multi-part prompts to Gemini AI Scene Director', () => {
    const res = parseVoiceCommand(
      'Build a peaceful Zen courtyard with two lanterns and a koi pond under twilight sky',
    );
    assert.equal(res.type, 'ai');
  });
});
