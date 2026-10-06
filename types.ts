export enum ChannelType {
  Red = 'R',
  Green = 'G',
  Blue = 'B',
  Alpha = 'A',
}

export enum AppMode {
  ChannelPacking = 'CHANNEL_PACKING',
  CombineAlpha = 'COMBINE_ALPHA',
  Convert16to8 = 'CONVERT_16_TO_8',
  Atlas = 'ATLAS',
  InvertMap = 'INVERT_MAP',
}

export type FallbackColor = 'black' | 'white';

export interface ChannelState {
  id: string; 
  file: File | null;
  previewUrl: string | null;
  fallback: FallbackColor;
  label: string;
  colorClass: string;
}

export interface PackOptions {
  atlasCols?: number;
  atlasRows?: number;
  invertChannels?: {
    r: boolean;
    g: boolean;
    b: boolean;
    a: boolean;
  };
}

export interface PackResult {
  url: string;
  width: number;
  height: number;
}