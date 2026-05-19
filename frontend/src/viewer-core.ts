export const FIT_MODES = {
  WIDTH: "width",
  HEIGHT: "height",
  BOTH: "both",
} as const;

export const TONE_MODES = {
  AUTO: "auto",
  INVERTED: "inverted",
  ORIGINAL: "original",
} as const;

export const THEMES = {
  LIGHT: "light",
  DARK: "dark",
} as const;

export const TONE_BRIGHTNESS_MIN = -60;
export const TONE_BRIGHTNESS_MAX = 60;
export const TONE_CONTRAST_MIN = -60;
export const TONE_CONTRAST_MAX = 100;
export const AUTO_DARK_BRIGHTNESS_OFFSET = 12;

export type FitMode = (typeof FIT_MODES)[keyof typeof FIT_MODES];
export type ToneMode = (typeof TONE_MODES)[keyof typeof TONE_MODES];
export type Theme = (typeof THEMES)[keyof typeof THEMES];

export interface Size {
  width: number;
  height: number;
}

export interface MediaLayoutOptions {
  fitMode: FitMode;
  rotation: number;
  zoom: number;
}

export interface MediaLayout {
  mediaWidth: number;
  mediaHeight: number;
  stageWidth: number;
  stageHeight: number;
  overflowX: boolean;
  overflowY: boolean;
}

export interface ToneOptions {
  inverted: boolean;
  autoNormalize: boolean;
  brightness: number;
  contrast: number;
}

export interface ToneState {
  mode: ToneMode;
  brightness: number;
  contrast: number;
  autoNormalize: boolean;
}

export interface LightnessRange {
  low: number;
  high: number;
}

export interface Oklab {
  l: number;
  a: number;
  b: number;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function nextToneMode(mode: ToneMode): ToneMode {
  if (mode === TONE_MODES.AUTO) return TONE_MODES.INVERTED;
  if (mode === TONE_MODES.INVERTED) return TONE_MODES.ORIGINAL;
  return TONE_MODES.AUTO;
}

export function nextTheme(theme: Theme): Theme {
  return theme === THEMES.DARK ? THEMES.LIGHT : THEMES.DARK;
}

export function normalizeToneBrightness(value: number): number {
  return normalizeBoundedNumber(value, TONE_BRIGHTNESS_MIN, TONE_BRIGHTNESS_MAX, 0);
}

export function normalizeToneContrast(value: number): number {
  return normalizeBoundedNumber(value, TONE_CONTRAST_MIN, TONE_CONTRAST_MAX, 0);
}

export function toneIsInverted(mode: ToneMode, theme: Theme): boolean {
  return mode === TONE_MODES.INVERTED || (mode === TONE_MODES.AUTO && theme === THEMES.DARK);
}

export function toneOptions(tone: ToneState, theme: Theme): ToneOptions {
  return {
    inverted: toneIsInverted(tone.mode, theme),
    autoNormalize: tone.autoNormalize,
    brightness: effectiveToneBrightness(tone, theme),
    contrast: tone.contrast,
  };
}

export function toneRequiresCanvas(tone: ToneState, theme: Theme): boolean {
  const options = toneOptions(tone, theme);
  return (
    options.inverted ||
    options.autoNormalize ||
    options.brightness !== 0 ||
    options.contrast !== 0
  );
}

export function toneHasAdjustments(tone: ToneState): boolean {
  return tone.brightness !== 0 || tone.contrast !== 0 || tone.autoNormalize;
}

export function fitScale(mode: FitMode, box: Size, bounds: Size): number {
  const safeBoxW = Math.max(1, box.width);
  const safeBoxH = Math.max(1, box.height);
  const safeBoundW = Math.max(1, bounds.width);
  const safeBoundH = Math.max(1, bounds.height);
  if (mode === FIT_MODES.WIDTH) return safeBoxW / safeBoundW;
  if (mode === FIT_MODES.HEIGHT) return safeBoxH / safeBoundH;
  return Math.min(safeBoxW / safeBoundW, safeBoxH / safeBoundH);
}

export function rotatedBounds(width: number, height: number, rotation: number): Size {
  return Math.abs(rotation) % 180 === 90
    ? { width: height, height: width }
    : { width, height };
}

export function mediaLayout(source: Size, viewport: Size, options: MediaLayoutOptions): MediaLayout {
  const bounds = rotatedBounds(source.width, source.height, options.rotation);
  const scale = fitScale(options.fitMode, viewport, bounds) * options.zoom;
  const mediaWidth = Math.max(1, Math.round(source.width * scale));
  const mediaHeight = Math.max(1, Math.round(source.height * scale));
  const stage = rotatedBounds(mediaWidth, mediaHeight, options.rotation);
  return {
    mediaWidth,
    mediaHeight,
    stageWidth: stage.width,
    stageHeight: stage.height,
    overflowX: stage.width > viewport.width + 1,
    overflowY: stage.height > viewport.height + 1,
  };
}

export function sourceLightness(lightness: number, inverted: boolean): number {
  return inverted ? 1 - lightness : lightness;
}

export function adjustedLightness(
  lightness: number,
  options: ToneOptions,
  range: LightnessRange = { low: 0, high: 1 },
): number {
  let next = lightness;
  if (options.autoNormalize && range.high - range.low > 0.025) {
    next = (next - range.low) / (range.high - range.low);
  }
  const contrast = 1 + options.contrast / 100;
  const brightness = options.brightness / 100;
  return clamp((next - 0.5) * contrast + 0.5 + brightness, 0, 1);
}

export function percentileLightness(
  histogram: ArrayLike<number>,
  totalPixels: number,
  percentile: number,
): number {
  if (totalPixels <= 0 || histogram.length === 0) return 0;
  const threshold = Math.max(1, Math.ceil(totalPixels * percentile));
  let cumulative = 0;
  for (let i = 0; i < histogram.length; i += 1) {
    cumulative += histogramNumber(histogram, i);
    if (cumulative >= threshold) {
      return i / Math.max(1, histogram.length - 1);
    }
  }
  return 1;
}

export function lightnessRangeFromHistogram(
  histogram: ArrayLike<number>,
  totalPixels: number,
  lowPercentile: number,
  highPercentile: number,
): LightnessRange {
  return {
    low: percentileLightness(histogram, totalPixels, lowPercentile),
    high: percentileLightness(histogram, totalPixels, highPercentile),
  };
}

export function srgbToOklab(r8: number, g8: number, b8: number): Oklab {
  const r = srgbToLinear(r8 / 255);
  const g = srgbToLinear(g8 / 255);
  const b = srgbToLinear(b8 / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function oklabToDisplaySrgb(l: number, a: number, b: number): Rgb {
  let chroma = 1;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const rgb = oklabToLinearSrgb(l, a * chroma, b * chroma);
    if (inGamut(rgb)) {
      return {
        r: linearToByte(rgb.r),
        g: linearToByte(rgb.g),
        b: linearToByte(rgb.b),
      };
    }
    chroma *= 0.82;
  }
  const rgb = oklabToLinearSrgb(l, a * chroma, b * chroma);
  return {
    r: linearToByte(clamp(rgb.r, 0, 1)),
    g: linearToByte(clamp(rgb.g, 0, 1)),
    b: linearToByte(clamp(rgb.b, 0, 1)),
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeBoundedNumber(
  value: number,
  min: number,
  max: number,
  fallback: number,
): number {
  return Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

function effectiveToneBrightness(tone: ToneState, theme: Theme): number {
  const offset =
    tone.mode === TONE_MODES.AUTO && theme === THEMES.DARK ? AUTO_DARK_BRIGHTNESS_OFFSET : 0;
  return clamp(tone.brightness + offset, TONE_BRIGHTNESS_MIN, TONE_BRIGHTNESS_MAX);
}

function histogramNumber(histogram: ArrayLike<number>, index: number): number {
  return histogram[index] as number;
}

function oklabToLinearSrgb(l: number, a: number, b: number): Rgb {
  const lPrime = l + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = l - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = l - 0.0894841775 * a - 1.291485548 * b;
  const l3 = lPrime * lPrime * lPrime;
  const m3 = mPrime * mPrime * mPrime;
  const s3 = sPrime * sPrime * sPrime;
  return {
    r: 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    g: -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    b: -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  };
}

function inGamut(rgb: Rgb): boolean {
  return (
    rgb.r >= 0 &&
    rgb.r <= 1 &&
    rgb.g >= 0 &&
    rgb.g <= 1 &&
    rgb.b >= 0 &&
    rgb.b <= 1
  );
}

function srgbToLinear(value: number): number {
  return value <= 0.04045
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
}

function linearToByte(value: number): number {
  const encoded =
    value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  return Math.round(clamp(encoded, 0, 1) * 255);
}
