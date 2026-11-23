/**
 * assetCatalog — typed wrapper around assets.json.
 *
 * This file is the single client-side authority on known asset IDs.
 * Loaded once at startup; never fetched per-request.
 */

// The JSON file is copied from assets catalog.
// Vite resolves it as a JSON module.
import catalogData from '../assets.json';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface AssetEntry {
  id: string;
  label: string;
  glb_path: string;
  category: string;
  default_scale: [number, number, number];
  min_scale: number;
  max_scale: number;
  pivot: string;
  tags: string[];
}

interface AssetCatalogFile {
  version: string;
  assets: AssetEntry[];
}

// ─── Catalog ───────────────────────────────────────────────────────────────

const catalog = catalogData as AssetCatalogFile;
const assetMap = new Map<string, AssetEntry>(
  catalog.assets.map((a) => [a.id, a]),
);

/** Returns the AssetEntry for a given catalog id, or undefined if unknown. */
export function getAsset(id: string): AssetEntry | undefined {
  return assetMap.get(id);
}

/** Returns all registered asset entries. */
export function getAllAssets(): AssetEntry[] {
  return catalog.assets;
}

/** Returns all registered asset IDs. */
export function getAllIds(): string[] {
  return Array.from(assetMap.keys());
}

/** Returns true if the given id exists in the catalog. */
export function isKnownAsset(id: string): boolean {
  return assetMap.has(id);
}
