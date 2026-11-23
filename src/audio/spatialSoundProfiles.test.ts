import assert from 'node:assert/strict';
import test from 'node:test';
import { getAllAssets } from '../catalog/assetCatalog';
import {
  computeSpatialDistanceParams,
  getSpatialSoundProfile,
} from './spatialSoundProfiles';

test('SpatialSoundProfiles', async (t) => {
  await t.test('maps every catalog asset to a valid positional sound profile', () => {
    const assets = getAllAssets();
    assert.equal(assets.length, 20);
    for (const asset of assets) {
      const profile = getSpatialSoundProfile(asset.id);
      assert.ok(profile.label.length > 0);
      assert.ok(profile.baseVolume > 0 && profile.baseVolume <= 0.4);
      assert.ok(profile.xrRefDistance < profile.desktopRefDistance);
      assert.ok(profile.xrMaxDistance < profile.desktopMaxDistance);
    }
  });

  await t.test('scales ref/max distances for XR tabletop and attenuates crowded scenes', () => {
    const water = getSpatialSoundProfile('fountain_stone');
    const soloDesktop = computeSpatialDistanceParams(water, false, 1);
    const soloXR = computeSpatialDistanceParams(water, true, 1);
    const crowdedXR = computeSpatialDistanceParams(water, true, 12);

    assert.equal(soloDesktop.refDistance, water.desktopRefDistance);
    assert.equal(soloXR.refDistance, water.xrRefDistance);
    assert.ok(soloXR.maxDistance < soloDesktop.maxDistance);
    assert.ok(crowdedXR.volume < soloXR.volume);
    assert.ok(crowdedXR.volume > 0);
  });
});
