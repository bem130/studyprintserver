import assert from "node:assert/strict";
import test from "node:test";
import {
  FIT_MODES,
  AUTO_DARK_BRIGHTNESS_OFFSET,
  THEMES,
  TONE_BRIGHTNESS_MAX,
  TONE_BRIGHTNESS_MIN,
  TONE_CONTRAST_MIN,
  TONE_MODES,
  adjustedLightness,
  lightnessRangeFromHistogram,
  mediaLayout,
  nextToneMode,
  normalizeToneBrightness,
  normalizeToneContrast,
  oklabToDisplaySrgb,
  sourceLightness,
  srgbToOklab,
  toneHasAdjustments,
  toneIsInverted,
  toneOptions,
  toneRequiresCanvas,
} from "../../static/viewer-core.js";

test("fit modes create the expected scroll direction", () => {
  const source = { width: 1000, height: 2000 };
  const viewport = { width: 500, height: 500 };

  const widthFit = mediaLayout(source, viewport, {
    fitMode: FIT_MODES.WIDTH,
    rotation: 0,
    zoom: 1,
  });
  assert.equal(widthFit.mediaWidth, 500);
  assert.equal(widthFit.overflowY, true);
  assert.equal(widthFit.overflowX, false);

  const heightFit = mediaLayout(source, viewport, {
    fitMode: FIT_MODES.HEIGHT,
    rotation: 0,
    zoom: 1,
  });
  assert.equal(heightFit.mediaHeight, 500);
  assert.equal(heightFit.overflowX, false);
  assert.equal(heightFit.overflowY, false);

  const pageFit = mediaLayout(source, viewport, {
    fitMode: FIT_MODES.BOTH,
    rotation: 0,
    zoom: 1,
  });
  assert.equal(pageFit.overflowX, false);
  assert.equal(pageFit.overflowY, false);
});

test("rotation participates in fit calculations", () => {
  const layout = mediaLayout(
    { width: 1000, height: 2000 },
    { width: 500, height: 500 },
    { fitMode: FIT_MODES.WIDTH, rotation: 90, zoom: 1 },
  );
  assert.equal(layout.stageWidth, 500);
  assert.equal(layout.overflowY, false);
});

test("tone mode transitions are deterministic", () => {
  assert.equal(nextToneMode(TONE_MODES.AUTO), TONE_MODES.INVERTED);
  assert.equal(nextToneMode(TONE_MODES.INVERTED), TONE_MODES.ORIGINAL);
  assert.equal(toneIsInverted(TONE_MODES.AUTO, THEMES.DARK), true);
  assert.equal(toneIsInverted(TONE_MODES.AUTO, THEMES.LIGHT), false);
});

test("tone numeric inputs are clamped before entering app state", () => {
  assert.equal(normalizeToneBrightness(999), TONE_BRIGHTNESS_MAX);
  assert.equal(normalizeToneBrightness(Number.NaN), 0);
  assert.equal(normalizeToneContrast(-999), TONE_CONTRAST_MIN);
  assert.equal(normalizeToneContrast(Number.POSITIVE_INFINITY), 0);
});

test("tone processing options are derived from one tone state", () => {
  const tone = {
    mode: TONE_MODES.AUTO,
    brightness: 0,
    contrast: 20,
    autoNormalize: false,
  };
  assert.deepEqual(toneOptions(tone, THEMES.DARK), {
    inverted: true,
    autoNormalize: false,
    brightness: AUTO_DARK_BRIGHTNESS_OFFSET,
    contrast: 20,
  });
  assert.equal(toneRequiresCanvas(tone, THEMES.DARK), true);
  assert.equal(toneHasAdjustments(tone), true);
});

test("dark auto tone raises paper lightness without mutating user brightness", () => {
  const tone = {
    mode: TONE_MODES.AUTO,
    brightness: 0,
    contrast: 0,
    autoNormalize: false,
  };

  assert.equal(tone.brightness, 0);
  assert.equal(toneHasAdjustments(tone), false);
  assert.equal(toneOptions(tone, THEMES.LIGHT).brightness, 0);
  assert.equal(toneOptions(tone, THEMES.DARK).brightness, AUTO_DARK_BRIGHTNESS_OFFSET);
  assert.equal(toneOptions({ ...tone, mode: TONE_MODES.INVERTED }, THEMES.DARK).brightness, 0);
});

test("lightness processing preserves explicit inversion and clamps output", () => {
  assert.equal(sourceLightness(0.2, true), 0.8);
  assert.equal(
    adjustedLightness(0.8, {
      inverted: false,
      autoNormalize: false,
      brightness: 60,
      contrast: 100,
    }),
    1,
  );
});

test("inverted tone turns paper dark while keeping pen hue orientation", () => {
  const paper = transformRgb({ r: 255, g: 255, b: 255 }, true);
  assert.equal(paper.r < 8 && paper.g < 8 && paper.b < 8, true);

  const ink = transformRgb({ r: 0, g: 0, b: 0 }, true);
  assert.equal(ink.r > 247 && ink.g > 247 && ink.b > 247, true);

  const redPen = transformRgb({ r: 220, g: 32, b: 32 }, true);
  assert.equal(redPen.r > redPen.g && redPen.r > redPen.b, true);
});

test("histogram range uses percentile bounds for auto normalization", () => {
  const histogram = new Uint32Array([1, 0, 2, 7]);
  const range = lightnessRangeFromHistogram(histogram, 10, 0.1, 0.9);
  assert.equal(range.low, 0);
  assert.equal(range.high, 1);
});

function transformRgb(rgb, inverted) {
  const lab = srgbToOklab(rgb.r, rgb.g, rgb.b);
  return oklabToDisplaySrgb(
    adjustedLightness(sourceLightness(lab.l, inverted), {
      inverted,
      autoNormalize: false,
      brightness: 0,
      contrast: 0,
    }),
    lab.a,
    lab.b,
  );
}
