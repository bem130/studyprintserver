import assert from "node:assert/strict";
import test from "node:test";
import {
  filteredItems,
  initModel,
  needsCanvasProcessing,
  selectedItem,
  update,
} from "../../static/ui-state.js";
import { FIT_MODES } from "../../static/viewer-core.js";

const settings = {
  theme: "light",
  imageTone: "auto",
  fitMode: "both",
  brightness: 0,
  contrast: 0,
  autoNormalize: false,
  filtersWidth: null,
  resultsWidth: null,
  previewHeight: null,
};

const items = [
  {
    global_content_id: "a",
    print_id: "p001",
    content_id: "c001",
    title: "微分",
    logical_date: "2026-05-17",
    primary_field_ref: "math",
    primary_field_path: "数学/微分",
    tags: ["微分", "数学"],
    image_url: "/library/a.png",
    text: "微分の問題",
    formula_count: 2,
  },
  {
    global_content_id: "b",
    print_id: "p002",
    content_id: "c002",
    title: "英作文",
    logical_date: "2026-05-18",
    primary_field_ref: "english",
    primary_field_path: "英語/作文",
    tags: ["英作文"],
    image_url: "/library/b.png",
    text: "writing",
    formula_count: 0,
  },
];

test("contents load selects the first filtered item", () => {
  const [initial] = initModel(settings);
  const [loaded] = update(initial, { type: "ContentsLoaded", items });
  assert.equal(selectedItem(loaded)?.global_content_id, "a");
  assert.equal(filteredItems(loaded).length, 2);
});

test("filter updates are pure state transitions with normalized selection", () => {
  const [initial] = initModel(settings);
  const [loaded] = update(initial, { type: "ContentsLoaded", items });
  const [filtered] = update(loaded, { type: "FieldChanged", value: "英語/作文" });
  assert.equal(filteredItems(filtered).length, 1);
  assert.equal(selectedItem(filtered)?.global_content_id, "b");
});

test("tone adjustments request canvas processing without touching DOM", () => {
  const [initial] = initModel(settings);
  const [loaded] = update(initial, { type: "ContentsLoaded", items });
  const [imageLoaded] = update(loaded, {
    type: "ImageLoaded",
    size: { width: 1000, height: 1400 },
  });
  const [adjusted, cmds] = update(imageLoaded, { type: "BrightnessChanged", value: 20 });
  assert.equal(needsCanvasProcessing(adjusted), true);
  assert.equal(cmds.some((cmd) => cmd.type === "ScheduleProcessImage"), true);
});

test("viewer controls are represented by typed messages", () => {
  const [initial] = initModel(settings);
  const [fitChanged, cmds] = update(initial, { type: "SetFitMode", mode: FIT_MODES.WIDTH });
  assert.equal(fitChanged.fitMode, FIT_MODES.WIDTH);
  assert.deepEqual(cmds[0], {
    type: "Persist",
    key: "studyprint-fit-mode",
    value: FIT_MODES.WIDTH,
  });
});
