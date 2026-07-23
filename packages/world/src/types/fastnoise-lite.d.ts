declare module 'fastnoise-lite' {
  type NoiseType = 'OpenSimplex2' | 'OpenSimplex2S' | 'Cellular' | 'Perlin' | 'ValueCubic' | 'Value';
  type FractalType = 'None' | 'FBm' | 'Ridged' | 'PingPong' | 'DomainWarpProgressive' | 'DomainWarpIndependent';

  export default class FastNoiseLite {
    static readonly NoiseType: Readonly<Record<'OpenSimplex2' | 'OpenSimplex2S' | 'Cellular' | 'Perlin' | 'ValueCubic' | 'Value', NoiseType>>;
    static readonly FractalType: Readonly<Record<'None' | 'FBm' | 'Ridged' | 'PingPong' | 'DomainWarpProgressive' | 'DomainWarpIndependent', FractalType>>;
    constructor(seed?: number);
    SetNoiseType(noiseType: NoiseType): void;
    SetFrequency(frequency: number): void;
    SetFractalType(fractalType: FractalType): void;
    SetFractalOctaves(octaves: number): void;
    SetFractalLacunarity(lacunarity: number): void;
    SetFractalGain(gain: number): void;
    GetNoise(x: number, y: number): number;
  }
}
