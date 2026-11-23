import { getAllAssets } from '../catalog/assetCatalog';
import type { AtmospherePreset } from '../scene/SceneState';

export type ParsedVoiceAction =
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'clear' }
  | { type: 'delete_selected' }
  | { type: 'duplicate_selected' }
  | { type: 'rotate_selected'; deltaRad: number }
  | { type: 'scale_selected'; factor: number }
  | { type: 'select_cycle'; dir: 1 | -1 }
  | { type: 'atmosphere'; preset: AtmospherePreset }
  | { type: 'toggle_hud'; visible?: boolean }
  | { type: 'reanchor' }
  | { type: 'spawn'; assetId: string; assetName: string }
  | { type: 'ai'; prompt: string };

const ASSET_SYNONYMS: Record<string, string[]> = {
  japanese_stall: ['stall', 'market', 'yatai', 'stand'],
  torii_gate: ['torii', 'shrine gate', 'vermilion gate'],
  tea_pavilion: ['pavilion', 'tea house', 'teahouse', 'pagoda'],
  ramen_cart: ['ramen', 'noodle', 'cart'],
  stone_lantern: ['lantern', 'toro'],
  cherry_blossom_tree: ['sakura', 'cherry blossom', 'blossom tree'],
  bamboo_cluster: ['bamboo'],
  koi_pond: ['koi', 'pond', 'bassin'],
  fountain_stone: ['fountain', 'fontaine'],
  park_bench: ['bench', 'banc'],
  cafe_table_umbrella: ['bistro', 'parasol', 'umbrella', 'cafe table'],
  street_lamp: ['street lamp', 'lamp', 'lampadaire'],
  stone_arch: ['gothic arch', 'arch', 'arche'],
  medieval_tower: ['watchtower', 'keep', 'castle tower', 'donjon'],
  modern_kiosk: ['kiosk', 'glass kiosk', 'kiosque'],
  cyber_tower: ['holotower', 'cyber tower', 'neon tower', 'hologram'],
  hover_rover: ['rover', 'hovercraft', 'vaisseau'],
  crystal_monolith: ['crystal', 'monolith', 'cristal'],
  sport_motorcycle: ['motorcycle', 'cafe racer', 'bike', 'moto'],
  pine_tree: ['pine', 'sapin', 'cedar pine'],
};

function matchAssetFromText(text: string): { id: string; name: string } | null {
  const assets = getAllAssets();
  const normalized = text.toLowerCase();

  for (const asset of assets) {
    if (
      normalized.includes(asset.name.toLowerCase()) ||
      normalized.includes(asset.id.replace(/_/g, ' '))
    ) {
      return { id: asset.id, name: asset.name };
    }
  }

  for (const asset of assets) {
    const synonyms = ASSET_SYNONYMS[asset.id] || [];
    if (synonyms.some((kw) => normalized.includes(kw))) {
      return { id: asset.id, name: asset.name };
    }
  }

  return null;
}

export function parseVoiceCommand(rawTranscript: string): ParsedVoiceAction {
  const cleaned = rawTranscript.trim();
  const low = cleaned.toLowerCase().replace(/[.!?]+$/g, '').trim();

  if (/^(undo|annule|annuler|retour)\b/.test(low)) {
    return { type: 'undo' };
  }
  if (/^(redo|r[eé]tablir|refaire)\b/.test(low)) {
    return { type: 'redo' };
  }
  if (/^(clear( scene)?|reset scene|tout effacer|efface(r)? tout|vider)\b/.test(low)) {
    return { type: 'clear' };
  }
  if (/^(delete( selected| object)?|remove( selected)?|supprime(r)?)\b/.test(low)) {
    return { type: 'delete_selected' };
  }
  if (/^(duplicate|clone|duplique(r)?)\b/.test(low)) {
    return { type: 'duplicate_selected' };
  }
  if (/^(rotate left|turn left|tourne(r)? [àa] gauche)\b/.test(low)) {
    return { type: 'rotate_selected', deltaRad: Math.PI / 4 };
  }
  if (/^(rotate right|turn right|tourne(r)? [àa] droite)\b/.test(low)) {
    return { type: 'rotate_selected', deltaRad: -Math.PI / 4 };
  }
  if (/^(bigger|scale up|grow|agrandir|plus grand)\b/.test(low)) {
    return { type: 'scale_selected', factor: 1.25 };
  }
  if (/^(smaller|scale down|shrink|r[eé]duire|plus petit)\b/.test(low)) {
    return { type: 'scale_selected', factor: 0.8 };
  }
  if (/^(next object|select next|objet suivant|suivant)\b/.test(low)) {
    return { type: 'select_cycle', dir: 1 };
  }
  if (/^(previous object|prev object|select previous|objet pr[eé]c[eé]dent|pr[eé]c[eé]dent)\b/.test(low)) {
    return { type: 'select_cycle', dir: -1 };
  }
  if (/^(re-?anchor|anchor table|r[eé]ancrer)\b/.test(low)) {
    return { type: 'reanchor' };
  }
  if (/^(show hud|open hud|show spatial hud|afficher hud)\b/.test(low)) {
    return { type: 'toggle_hud', visible: true };
  }
  if (/^(hide hud|close hud|masquer hud)\b/.test(low)) {
    return { type: 'toggle_hud', visible: false };
  }
  if (
    /^(set |switch to |mode )?(daylight|day|jour|mati[n]?)\b/.test(low) &&
    low.split(/\s+/).length <= 4
  ) {
    return { type: 'atmosphere', preset: 'daylight' };
  }
  if (
    /^(set |switch to |mode )?(golden|sunset|dor[eé]|couchant)\b/.test(low) &&
    low.split(/\s+/).length <= 4
  ) {
    return { type: 'atmosphere', preset: 'golden' };
  }
  if (
    /^(set |switch to |mode )?(twilight|night|nuit|cr[eé]puscule)\b/.test(low) &&
    low.split(/\s+/).length <= 4
  ) {
    return { type: 'atmosphere', preset: 'twilight' };
  }

  // Short direct spawn commands (e.g. "add torii gate", "ajoute un sakura", "spawn rover")
  const words = low.split(/\s+/);
  if (
    words.length <= 5 &&
    /^(add|spawn|place|create|ajoute|ajouter|mets|met|placez)\b/.test(low)
  ) {
    const matched = matchAssetFromText(low);
    if (matched) {
      return { type: 'spawn', assetId: matched.id, assetName: matched.name };
    }
  }

  return { type: 'ai', prompt: cleaned };
}
