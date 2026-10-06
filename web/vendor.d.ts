declare module 'upng-js' {
  interface Png { width: number; height: number }
  const UPNG: {
    decode(data: ArrayBuffer): Png;
    toRGBA8(png: Png): ArrayBuffer[];
    encode(data: ArrayBuffer[], width: number, height: number, colors: number, delays?: number[], forbidPalette?: boolean): ArrayBuffer;
  };
  export default UPNG;
}
