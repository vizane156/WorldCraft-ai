export type SpatialSoundKind =
  | 'water'
  | 'zen_chime'
  | 'foliage_breeze'
  | 'market_hearth'
  | 'cyber_pulse'
  | 'hover_hum'
  | 'urban_courtyard';

export interface SpatialSoundProfile {
  kind: SpatialSoundKind;
  label: string;
  baseVolume: number;
  rolloffFactor: number;
  desktopRefDistance: number;
  xrRefDistance: number;
  desktopMaxDistance: number;
  xrMaxDistance: number;
}

const SOUND_PROFILES: Record<SpatialSoundKind, SpatialSoundProfile> = {
  water: {
    kind: 'water',
    label: 'Water & Fountain Flow',
    baseVolume: 0.24,
    rolloffFactor: 1.4,
    desktopRefDistance: 2.2,
    xrRefDistance: 0.45,
    desktopMaxDistance: 16,
    xrMaxDistance: 3.6,
  },
  zen_chime: {
    kind: 'zen_chime',
    label: 'Temple Wind & Bell',
    baseVolume: 0.18,
    rolloffFactor: 1.35,
    desktopRefDistance: 2.4,
    xrRefDistance: 0.5,
    desktopMaxDistance: 18,
    xrMaxDistance: 4.0,
  },
  foliage_breeze: {
    kind: 'foliage_breeze',
    label: 'Leaves & Bamboo Breeze',
    baseVolume: 0.16,
    rolloffFactor: 1.5,
    desktopRefDistance: 2.0,
    xrRefDistance: 0.42,
    desktopMaxDistance: 14,
    xrMaxDistance: 3.2,
  },
  market_hearth: {
    kind: 'market_hearth',
    label: 'Warm Lantern & Stall',
    baseVolume: 0.2,
    rolloffFactor: 1.45,
    desktopRefDistance: 2.0,
    xrRefDistance: 0.42,
    desktopMaxDistance: 15,
    xrMaxDistance: 3.4,
  },
  cyber_pulse: {
    kind: 'cyber_pulse',
    label: 'Holo Resonance Pulse',
    baseVolume: 0.22,
    rolloffFactor: 1.35,
    desktopRefDistance: 2.5,
    xrRefDistance: 0.52,
    desktopMaxDistance: 18,
    xrMaxDistance: 4.2,
  },
  hover_hum: {
    kind: 'hover_hum',
    label: 'Turbine Idle Hum',
    baseVolume: 0.2,
    rolloffFactor: 1.5,
    desktopRefDistance: 2.1,
    xrRefDistance: 0.45,
    desktopMaxDistance: 15,
    xrMaxDistance: 3.5,
  },
  urban_courtyard: {
    kind: 'urban_courtyard',
    label: 'Courtyard Air',
    baseVolume: 0.14,
    rolloffFactor: 1.55,
    desktopRefDistance: 2.0,
    xrRefDistance: 0.4,
    desktopMaxDistance: 14,
    xrMaxDistance: 3.0,
  },
};

const ASSET_TO_KIND: Record<string, SpatialSoundKind> = {
  koi_pond: 'water',
  fountain_stone: 'water',
  torii_gate: 'zen_chime',
  tea_pavilion: 'zen_chime',
  stone_lantern: 'market_hearth',
  japanese_stall: 'market_hearth',
  ramen_cart: 'market_hearth',
  cherry_blossom_tree: 'foliage_breeze',
  bamboo_cluster: 'foliage_breeze',
  pine_tree: 'foliage_breeze',
  cyber_tower: 'cyber_pulse',
  crystal_monolith: 'cyber_pulse',
  modern_kiosk: 'cyber_pulse',
  hover_rover: 'hover_hum',
  sport_motorcycle: 'hover_hum',
  park_bench: 'urban_courtyard',
  cafe_table_umbrella: 'urban_courtyard',
  street_lamp: 'urban_courtyard',
  stone_arch: 'urban_courtyard',
  medieval_tower: 'zen_chime',
};

export function getSpatialSoundProfile(assetId: string): SpatialSoundProfile {
  const kind = ASSET_TO_KIND[assetId] ?? 'urban_courtyard';
  return SOUND_PROFILES[kind];
}

export function computeSpatialDistanceParams(
  profile: SpatialSoundProfile,
  inXR: boolean,
  activeEmitterCount: number,
): {
  volume: number;
  refDistance: number;
  maxDistance: number;
  rolloffFactor: number;
} {
  // Attenuate gently as scene density grows so 20+ emitters never clip
  const crowdScale =
    activeEmitterCount <= 1
      ? 1
      : Math.max(0.28, 1 / Math.sqrt(Math.min(activeEmitterCount, 18)));

  return {
    volume: Number((profile.baseVolume * crowdScale).toFixed(4)),
    refDistance: inXR ? profile.xrRefDistance : profile.desktopRefDistance,
    maxDistance: inXR ? profile.xrMaxDistance : profile.desktopMaxDistance,
    rolloffFactor: profile.rolloffFactor,
  };
}
