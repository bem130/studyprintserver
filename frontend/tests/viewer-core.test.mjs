import assert from "node:assert/strict";
import test from "node:test";
import {
  FIT_MODES,
  TONE_MODES,
  adjustedLightness,
  lightnessRangeFromHistogram,
  mediaLayout,
  nextToneMode,
  normalizeFitMode,
  sourceLightness,
  toneIsInverted,
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

test("tone mode and fit mode normalization are deterministic", () => {
  assert.equal(normalizeFitMode("unknown"), FIT_MODES.BOTH);
  assert.equal(nextToneMode(TONE_MODES.AUTO), TONE_MODES.INVERTED);
  assert.equal(nextToneMode(TONE_MODES.INVERTED), TONE_MODES.ORIGINAL);
  assert.equal(toneIsInverted(TONE_MODES.AUTO, "dark"), true);
  assert.equal(toneIsInverted(TONE_MODES.AUTO, "light"), false);
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

test("histogram range uses percentile bounds for auto normalization", () => {
  const histogram = new Uint32Array([1, 0, 2, 7]);
  const range = lightnessRangeFromHistogram(histogram, 10, 0.1, 0.9);
  assert.equal(range.low, 0);
  assert.equal(range.high, 1);
});
