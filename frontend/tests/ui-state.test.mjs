import assert from "node:assert/strict";
import test from "node:test";
import {
  DETAIL_TABS,
  fieldCounts,
  filteredItems,
  FULLSCREEN_TARGETS,
  FULLSCREEN_TOOLS,
  initModel,
  needsCanvasProcessing,
  selectedItem,
  update,
} from "../../static/ui-state.js";
import { isSome, some } from "../../static/option.js";
import { FIT_MODES, THEMES, TONE_MODES } from "../../static/viewer-core.js";

const items = [
  {
    global_content_id: "a",
    print_id: "p001",
    title: "微分",
    logical_date: "2026-05-17",
    primary_field_path: "数学/微分",
    tags: ["微分", "数学"],
    image_url: "/library/a.png",
    xml_url: "/library/a.xml",
    xml_text: "<print><body>微分の問題</body></print>",
    text: "微分の問題",
    formula_count: 2,
  },
  {
    global_content_id: "b",
    print_id: "p002",
    title: "英作文",
    logical_date: "2026-05-18",
    primary_field_path: "英語/作文",
    tags: ["英作文"],
    image_url: "/library/b.png",
    xml_url: "/library/b.xml",
    xml_text: "<print><body>writing</body></print>",
    text: "writing",
    formula_count: 0,
  },
];

const hierarchyItems = [
  ...items,
  {
    global_content_id: "c",
    print_id: "p003",
    title: "確率",
    logical_date: "2026-05-18",
    primary_field_path: "数学/確率/反復試行",
    tags: ["確率", "数学"],
    image_url: "/library/c.png",
    xml_url: "/library/c.xml",
    xml_text: "<print><body>確率の問題</body></print>",
    text: "確率の問題",
    formula_count: 1,
  },
];

test("contents load selects the first filtered item", () => {
  const [initial] = initModel();
  const [loaded] = update(initial, { type: "ContentsLoaded", items });
  const selected = selectedItem(loaded);
  assert.equal(isSome(selected), true);
  if (isSome(selected)) assert.equal(selected.value.global_content_id, "a");
  assert.equal(filteredItems(loaded).length, 2);
});

test("prototype state starts from deterministic defaults", () => {
  const [initial] = initModel();
  assert.equal(initial.theme, THEMES.LIGHT);
  assert.equal(initial.tone.mode, TONE_MODES.AUTO);
  assert.equal(initial.tone.brightness, 0);
  assert.equal(initial.tone.contrast, 0);
  assert.equal(initial.tone.autoNormalize, false);
  assert.equal(isSome(initial.fullscreen), false);
  assert.equal(initial.detailTab, DETAIL_TABS.BODY);
  assert.deepEqual(initial.collapsedXmlPaths, []);
});

test("filter updates are pure state transitions with normalized selection", () => {
  const [initial] = initModel();
  const [loaded] = update(initial, { type: "ContentsLoaded", items });
  const [filtered] = update(loaded, { type: "FieldChanged", value: some("英語/作文") });
  assert.equal(filteredItems(filtered).length, 1);
  const selected = selectedItem(filtered);
  assert.equal(isSome(selected), true);
  if (isSome(selected)) assert.equal(selected.value.global_content_id, "b");
});

test("field filters match broad path prefixes and counts include ancestors", () => {
  const [initial] = initModel();
  const [loaded] = update(initial, { type: "ContentsLoaded", items: hierarchyItems });
  const counts = fieldCounts(loaded);

  assert.equal(counts.get("数学"), 2);
  assert.equal(counts.get("数学/微分"), 1);
  assert.equal(counts.get("数学/確率"), 1);
  assert.equal(counts.get("数学/確率/反復試行"), 1);

  const [mathFiltered] = update(loaded, { type: "FieldChanged", value: some("数学/") });
  assert.deepEqual(
    filteredItems(mathFiltered).map((item) => item.global_content_id),
    ["a", "c"],
  );

  const [probabilityFiltered] = update(loaded, { type: "FieldChanged", value: some("数学/確率") });
  assert.deepEqual(
    filteredItems(probabilityFiltered).map((item) => item.global_content_id),
    ["c"],
  );
});

test("tone adjustments request canvas processing without touching DOM", () => {
  const [initial] = initModel();
  const [loaded] = update(initial, { type: "ContentsLoaded", items });
  const [imageLoaded] = update(loaded, {
    type: "ImageLoaded",
    size: { width: 1000, height: 1400 },
  });
  const [adjusted, cmds] = update(imageLoaded, { type: "BrightnessChanged", value: 20 });
  assert.equal(needsCanvasProcessing(adjusted), true);
  assert.equal(cmds.some((cmd) => cmd.type === "SyncImageProcessing"), true);
});

test("theme changes derive effective image processing from the unified tone state", () => {
  const [initial] = initModel();
  const [loaded] = update(initial, { type: "ContentsLoaded", items });
  const [imageLoaded] = update(loaded, {
    type: "ImageLoaded",
    size: { width: 1000, height: 1400 },
  });
  const previousToken = imageLoaded.image.token;
  const [dark, cmds] = update(imageLoaded, { type: "ToggleTheme" });

  assert.equal(dark.theme, THEMES.DARK);
  assert.equal(dark.tone.mode, TONE_MODES.AUTO);
  assert.equal(dark.image.token, previousToken + 1);
  assert.equal(needsCanvasProcessing(dark), true);
  assert.equal(cmds.some((cmd) => cmd.type === "SyncImageProcessing"), true);
});

test("tone input messages clamp invalid numbers inside the model", () => {
  const [initial] = initModel();
  const [loaded] = update(initial, { type: "ContentsLoaded", items });
  const [imageLoaded] = update(loaded, {
    type: "ImageLoaded",
    size: { width: 1000, height: 1400 },
  });
  const [adjusted, cmds] = update(imageLoaded, { type: "BrightnessChanged", value: Number.NaN });

  assert.equal(adjusted.tone.brightness, 0);
  assert.equal(cmds.some((cmd) => cmd.type === "SyncImageProcessing"), true);
});

test("tone changes request rendering without storing rendered image state", () => {
  const [initial] = initModel();
  const [loaded] = update(initial, { type: "ContentsLoaded", items });
  const [imageLoaded] = update(loaded, {
    type: "ImageLoaded",
    size: { width: 1000, height: 1400 },
  });
  const [adjusted, cmds] = update(imageLoaded, { type: "ContrastChanged", value: 25 });

  assert.deepEqual(Object.keys(adjusted.image).sort(), ["naturalSize", "token"]);
  assert.equal(adjusted.image.token, imageLoaded.image.token + 1);
  assert.equal(cmds.some((cmd) => cmd.type === "SyncImageProcessing"), true);
});

test("viewer controls are represented by typed messages", () => {
  const [initial] = initModel();
  const [fitChanged, cmds] = update(initial, { type: "SetFitMode", mode: FIT_MODES.WIDTH });
  assert.equal(fitChanged.fitMode, FIT_MODES.WIDTH);
  assert.deepEqual(cmds, []);
});

test("detail data tabs and xml expansion are modeled in TypeScript state", () => {
  const [initial] = initModel();
  const [treeTab] = update(initial, { type: "SetDetailTab", tab: DETAIL_TABS.XML_TREE });
  assert.equal(treeTab.detailTab, DETAIL_TABS.XML_TREE);

  const [collapsed] = update(treeTab, { type: "ToggleXmlNode", path: "0/1" });
  assert.deepEqual(collapsed.collapsedXmlPaths, ["0/1"]);

  const [expanded] = update(collapsed, { type: "ToggleXmlNode", path: "0/1" });
  assert.deepEqual(expanded.collapsedXmlPaths, []);
});

test("fullscreen tools tab pins the panel so controls stay usable", () => {
  const [initial] = initModel();
  const [fullscreen] = update(initial, { type: "FullscreenChanged", target: some(FULLSCREEN_TARGETS.PREVIEW) });
  const [opened] = update(fullscreen, { type: "ToggleFullscreenTools" });
  assert.equal(opened.fullscreenTools, FULLSCREEN_TOOLS.PINNED);

  const [closed] = update(opened, { type: "ToggleFullscreenTools" });
  assert.equal(closed.fullscreenTools, FULLSCREEN_TOOLS.HIDDEN);

  const [reopened] = update(closed, { type: "ToggleFullscreenTools" });
  const [hidden] = update(reopened, { type: "HideFullscreenTools" });
  assert.equal(hidden.fullscreenTools, FULLSCREEN_TOOLS.HIDDEN);
});

test("fullscreen hover visibility is modeled in TypeScript state", () => {
  const [initial] = initModel();
  const [fullscreen] = update(initial, { type: "FullscreenChanged", target: some(FULLSCREEN_TARGETS.PREVIEW) });
  const [hovered] = update(fullscreen, { type: "FullscreenToolsPointerEntered" });
  assert.equal(hovered.fullscreenTools, FULLSCREEN_TOOLS.HOVER_OPEN);

  const [left] = update(hovered, { type: "FullscreenToolsPointerLeft" });
  assert.equal(left.fullscreenTools, FULLSCREEN_TOOLS.HOVER_READY);
});

test("fullscreen target is explicit and body fullscreen does not open image tools", () => {
  const [initial] = initModel();
  const [bodyFullscreen] = update(initial, { type: "FullscreenChanged", target: some(FULLSCREEN_TARGETS.BODY) });
  assert.equal(isSome(bodyFullscreen.fullscreen), true);
  if (isSome(bodyFullscreen.fullscreen)) assert.equal(bodyFullscreen.fullscreen.value, FULLSCREEN_TARGETS.BODY);

  const [, cmds] = update(bodyFullscreen, {
    type: "RequestFullscreenToggle",
    target: FULLSCREEN_TARGETS.BODY,
  });
  assert.deepEqual(cmds, [{ type: "ToggleFullscreen", target: FULLSCREEN_TARGETS.BODY }]);
});
