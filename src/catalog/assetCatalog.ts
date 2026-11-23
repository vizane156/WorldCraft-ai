import assetsData from './assets.json';

export interface AssetDefinition {
  id: string;
  name: string;
  category: string;
  theme: string;
  defaultScale: number;
  boundingRadius: number;
  defaultColor: string;
  summary: string;
}

export const ASSET_CATALOG: AssetDefinition[] = assetsData as AssetDefinition[];

const ASSET_MAP = new Map<string, AssetDefinition>(
  ASSET_CATALOG.map((asset) => [asset.id, asset]),
);

export function getAsset(assetId: string): AssetDefinition | undefined {
  return ASSET_MAP.get(assetId);
}

export function getAllAssets(): AssetDefinition[] {
  return ASSET_CATALOG;
}

export function getAssetsByCategory(): Map<string, AssetDefinition[]> {
  const grouped = new Map<string, AssetDefinition[]>();
  for (const asset of ASSET_CATALOG) {
    const existing = grouped.get(asset.category);
    if (existing) {
      existing.push(asset);
    } else {
      grouped.set(asset.category, [asset]);
    }
  }
  return grouped;
}
