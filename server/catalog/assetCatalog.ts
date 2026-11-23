import assetsData from './assets.json' with { type: 'json' };

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

export function getCatalogPromptText(): string {
  return ASSET_CATALOG.map(
    (a) =>
      `- ${a.id} (${a.name}, ${a.category}, radius=${a.boundingRadius}m, defaultColor=${a.defaultColor}): ${a.summary}`,
  ).join('\n');
}
