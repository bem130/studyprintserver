import {
  FIT_MODES,
  THEMES,
  TONE_MODES,
  clamp,
  nextTheme,
  nextToneMode,
  normalizeToneBrightness,
  normalizeToneContrast,
  toneHasAdjustments,
  toneRequiresCanvas,
  type FitMode,
  type Size,
  type Theme,
  type ToneState,
} from "./viewer-core.js";
import { isSome, none, optionMap, optionValueOr, some, type Option } from "./option.js";
import type { StudyPrintItem } from "./generated/api-types.js";

export type { StudyPrintItem };

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 4;
export const ZOOM_STEP = 0.25;
export const MIN_FILTERS_WIDTH = 180;
export const MIN_RESULTS_WIDTH = 260;
export const MIN_DETAIL_WIDTH = 360;
export const MIN_PREVIEW_HEIGHT = 220;
export const MIN_DETAIL_INFO_HEIGHT = 190;
export const HANDLE_WIDTH_TOTAL = 14;

export const FULLSCREEN_TOOLS = {
  HOVER_READY: "hover_ready",
  HOVER_OPEN: "hover_open",
  PINNED: "pinned",
  HIDDEN: "hidden",
} as const;

export type FullscreenToolsState = (typeof FULLSCREEN_TOOLS)[keyof typeof FULLSCREEN_TOOLS];

export const FULLSCREEN_TARGETS = {
  PREVIEW: "preview",
  BODY: "body",
} as const;

export type FullscreenTarget = (typeof FULLSCREEN_TARGETS)[keyof typeof FULLSCREEN_TARGETS];

export const DETAIL_TABS = {
  BODY: "body",
  XML_TREE: "xml_tree",
  XML_RAW: "xml_raw",
} as const;

export type DetailTab = (typeof DETAIL_TABS)[keyof typeof DETAIL_TABS];

export interface LayoutState {
  filtersWidth: Option<number>;
  resultsWidth: Option<number>;
  previewHeight: Option<number>;
  previewViewport: Option<Size>;
}

export interface ImageState {
  naturalSize: Option<Size>;
  token: number;
}

export interface Model {
  items: StudyPrintItem[];
  selectedId: Option<string>;
  status: string;
  search: string;
  field: Option<string>;
  date: Option<string>;
  tag: Option<string>;
  theme: Theme;
  tone: ToneState;
  fitMode: FitMode;
  rotation: number;
  zoom: number;
  fullscreen: Option<FullscreenTarget>;
  fullscreenTools: FullscreenToolsState;
  detailTab: DetailTab;
  collapsedXmlPaths: string[];
  layout: LayoutState;
  image: ImageState;
}

export interface LayoutMetrics {
  workspaceWidth: number;
  detailHeight: number;
  detailHeadHeight: number;
  previewViewport: Size;
}

export type ResizeTarget = "filters" | "results" | "preview";

export type Msg =
  | { type: "ContentsLoaded"; items: StudyPrintItem[] }
  | { type: "ContentsFailed"; message: string }
  | { type: "SearchChanged"; value: string }
  | { type: "FieldChanged"; value: Option<string> }
  | { type: "DateChanged"; value: Option<string> }
  | { type: "TagToggled"; tag: string }
  | { type: "SelectItem"; id: Option<string> }
  | { type: "ToggleTheme" }
  | { type: "CycleTone" }
  | { type: "ToggleNormalize" }
  | { type: "ResetToneAdjustments" }
  | { type: "BrightnessChanged"; value: number }
  | { type: "ContrastChanged"; value: number }
  | { type: "RotateBy"; degrees: number }
  | { type: "ZoomBy"; delta: number }
  | { type: "SetFitMode"; mode: FitMode }
  | { type: "SetDetailTab"; tab: DetailTab }
  | { type: "ToggleXmlNode"; path: string }
  | { type: "ResetView" }
  | { type: "ImageLoaded"; size: Size }
  | { type: "LayoutMeasured"; metrics: LayoutMetrics }
  | { type: "ResizePanel"; target: ResizeTarget; value: number; metrics: LayoutMetrics }
  | { type: "FullscreenChanged"; target: Option<FullscreenTarget> }
  | { type: "FullscreenToolsPointerEntered" }
  | { type: "FullscreenToolsPointerLeft" }
  | { type: "ToggleFullscreenTools" }
  | { type: "HideFullscreenTools" }
  | { type: "ToggleFullscreenToolsPin" }
  | { type: "RequestFullscreenToggle"; target: FullscreenTarget };

export type Cmd =
  | { type: "LoadContents" }
  | { type: "MeasureLayout" }
  | { type: "SyncImageProcessing"; token: number }
  | { type: "ToggleFullscreen"; target: FullscreenTarget };

export function initModel(): [Model, Cmd[]] {
  const model: Model = {
    items: [],
    selectedId: none(),
    status: "Loading index...",
    search: "",
    field: none(),
    date: none(),
    tag: none(),
    theme: THEMES.LIGHT,
    tone: {
      mode: TONE_MODES.AUTO,
      brightness: 0,
      contrast: 0,
      autoNormalize: false,
    },
    fitMode: FIT_MODES.BOTH,
    rotation: 0,
    zoom: 1,
    fullscreen: none(),
    fullscreenTools: FULLSCREEN_TOOLS.HOVER_READY,
    detailTab: DETAIL_TABS.BODY,
    collapsedXmlPaths: [],
    layout: {
      filtersWidth: none(),
      resultsWidth: none(),
      previewHeight: none(),
      previewViewport: none(),
    },
    image: {
      naturalSize: none(),
      token: 0,
    },
  };
  return [model, [{ type: "LoadContents" }, { type: "MeasureLayout" }]];
}

export function update(model: Model, msg: Msg): [Model, Cmd[]] {
  switch (msg.type) {
    case "ContentsLoaded": {
      const next = normalizeSelection({
        ...model,
        items: msg.items,
        status: "Index loaded",
      });
      return [next, [{ type: "MeasureLayout" }]];
    }
    case "ContentsFailed":
      return [{ ...model, status: msg.message }, []];
    case "SearchChanged":
      return [normalizeSelection({ ...model, search: msg.value }), []];
    case "FieldChanged":
      return [normalizeSelection({ ...model, field: msg.value }), []];
    case "DateChanged":
      return [normalizeSelection({ ...model, date: msg.value }), []];
    case "TagToggled":
      return [normalizeSelection({ ...model, tag: nextTag(model.tag, msg.tag) }), []];
    case "SelectItem":
      return [selectedImageReset({ ...model, selectedId: msg.id }), [{ type: "MeasureLayout" }]];
    case "ToggleTheme": {
      const next = invalidateProcessedImage({
        ...model,
        theme: nextTheme(model.theme),
      });
      return [next, imageProcessCmd(next)];
    }
    case "CycleTone": {
      const next = invalidateProcessedImage({
        ...model,
        tone: { ...model.tone, mode: nextToneMode(model.tone.mode) },
      });
      return [next, imageProcessCmd(next)];
    }
    case "ToggleNormalize": {
      const next = invalidateProcessedImage({
        ...model,
        tone: { ...model.tone, autoNormalize: !model.tone.autoNormalize },
      });
      return [next, imageProcessCmd(next)];
    }
    case "ResetToneAdjustments": {
      const next = invalidateProcessedImage({
        ...model,
        tone: { ...model.tone, brightness: 0, contrast: 0, autoNormalize: false },
      });
      return [next, imageProcessCmd(next)];
    }
    case "BrightnessChanged": {
      const next = invalidateProcessedImage({
        ...model,
        tone: { ...model.tone, brightness: normalizeToneBrightness(msg.value) },
      });
      return [next, imageProcessCmd(next)];
    }
    case "ContrastChanged": {
      const next = invalidateProcessedImage({
        ...model,
        tone: { ...model.tone, contrast: normalizeToneContrast(msg.value) },
      });
      return [next, imageProcessCmd(next)];
    }
    case "RotateBy":
      return [{ ...model, rotation: normalizeRotation(model.rotation + msg.degrees) }, []];
    case "ZoomBy":
      return [{ ...model, zoom: clamp(model.zoom + msg.delta, MIN_ZOOM, MAX_ZOOM) }, []];
    case "SetFitMode":
      return [{ ...model, fitMode: msg.mode }, []];
    case "SetDetailTab":
      return [{ ...model, detailTab: msg.tab }, []];
    case "ToggleXmlNode":
      return [{ ...model, collapsedXmlPaths: toggleString(model.collapsedXmlPaths, msg.path) }, []];
    case "ResetView":
      return [{ ...model, rotation: 0, zoom: 1 }, []];
    case "ImageLoaded": {
      const next = invalidateProcessedImage({
        ...model,
        image: {
          naturalSize: some(msg.size),
          token: model.image.token + 1,
        },
      });
      return [next, [{ type: "MeasureLayout" }, ...imageProcessCmd(next)]];
    }
    case "LayoutMeasured":
      return [applyLayoutMetrics(model, msg.metrics), []];
    case "ResizePanel": {
      const next = resizePanel(model, msg.target, msg.value, msg.metrics);
      return [next, []];
    }
    case "FullscreenChanged":
      return [
        {
          ...model,
          fullscreen: msg.target,
          fullscreenTools: isSome(msg.target) ? model.fullscreenTools : FULLSCREEN_TOOLS.HOVER_READY,
        },
        [{ type: "MeasureLayout" }],
      ];
    case "FullscreenToolsPointerEntered":
      return [
        {
          ...model,
          fullscreenTools:
            model.fullscreenTools === FULLSCREEN_TOOLS.HOVER_READY
              ? FULLSCREEN_TOOLS.HOVER_OPEN
              : model.fullscreenTools,
        },
        [],
      ];
    case "FullscreenToolsPointerLeft":
      return [
        {
          ...model,
          fullscreenTools:
            model.fullscreenTools === FULLSCREEN_TOOLS.HOVER_OPEN
              ? FULLSCREEN_TOOLS.HOVER_READY
              : model.fullscreenTools,
        },
        [],
      ];
    case "ToggleFullscreenTools": {
      return [
        {
          ...model,
          fullscreenTools: nextFullscreenToolsFromTab(model.fullscreenTools),
        },
        [],
      ];
    }
    case "HideFullscreenTools":
      return [
        {
          ...model,
          fullscreenTools: FULLSCREEN_TOOLS.HIDDEN,
        },
        [],
      ];
    case "ToggleFullscreenToolsPin":
      return [
        {
          ...model,
          fullscreenTools: nextFullscreenToolsFromPin(model.fullscreenTools),
        },
        [],
      ];
    case "RequestFullscreenToggle":
      return [model, [{ type: "ToggleFullscreen", target: msg.target }]];
  }
}

export function filteredItems(model: Model): StudyPrintItem[] {
  const query = model.search.trim().toLowerCase();
  return model.items.filter((item) => {
    const searchable = [
      item.title,
      item.primary_field_path,
      item.print_id,
      item.text,
      item.tags.join(" "),
    ]
      .join(" ")
      .toLowerCase();
    return (
      queryMatches(query, searchable) &&
      fieldMatches(model.field, item) &&
      dateMatches(model.date, item) &&
      tagMatches(model.tag, item)
    );
  });
}

export function selectedItem(model: Model): Option<StudyPrintItem> {
  if (!isSome(model.selectedId)) return none();
  const selectedId = model.selectedId.value;
  return findOption(model.items, (candidate) => candidate.global_content_id === selectedId);
}

export function metricValues(model: Model): { contents: number; fields: number; formulas: number } {
  return {
    contents: model.items.length,
    fields: new Set(model.items.map((item) => item.primary_field_path)).size,
    formulas: model.items.reduce((sum, item) => sum + item.formula_count, 0),
  };
}

export function fieldCounts(model: Model): Map<string, number> {
  const counts = new Map<string, number>();
  model.items.forEach((item) => {
    fieldPathOptions(item.primary_field_path).forEach((path) => {
      counts.set(path, mapCount(counts, path) + 1);
    });
  });
  return counts;
}

export function dateCounts(model: Model): Map<string, number> {
  return countBy(model.items, (item) => item.logical_date);
}

export function tagCounts(model: Model): Map<string, number> {
  return countBy(
    model.items.flatMap((item) => item.tags),
    (tag) => tag,
  );
}

export function activeSourceSize(model: Model): Option<Size> {
  return model.image.naturalSize;
}

export function needsCanvasProcessing(model: Model): boolean {
  return toneRequiresCanvas(model.tone, model.theme);
}

export function toneAdjustmentsActive(model: Model): boolean {
  return toneHasAdjustments(model.tone);
}

export function toneLabel(model: Model): string {
  if (model.tone.mode === TONE_MODES.AUTO) return "Auto";
  if (model.tone.mode === TONE_MODES.INVERTED) return "Invert";
  return "Paper";
}

function normalizeSelection(model: Model): Model {
  const filtered = filteredItems(model);
  if (filtered.length === 0) {
    return selectedImageReset({ ...model, selectedId: none() });
  }
  if (isSome(model.selectedId)) {
    const selectedId = model.selectedId.value;
    if (filtered.some((item) => item.global_content_id === selectedId)) {
      return model;
    }
  }
  const first = firstOption(filtered);
  return selectedImageReset({
    ...model,
    selectedId: optionMap(first, (item) => item.global_content_id),
  });
}

function queryMatches(query: string, searchable: string): boolean {
  if (query.length === 0) return true;
  return searchable.includes(query);
}

function fieldMatches(field: Option<string>, item: StudyPrintItem): boolean {
  if (!isSome(field)) return true;
  const selected = normalizeFieldPath(field.value);
  if (selected.length === 0) return true;
  const itemPath = normalizeFieldPath(item.primary_field_path);
  return itemPath === selected || itemPath.startsWith(`${selected}/`);
}

function dateMatches(date: Option<string>, item: StudyPrintItem): boolean {
  if (!isSome(date)) return true;
  return item.logical_date === date.value;
}

function tagMatches(tag: Option<string>, item: StudyPrintItem): boolean {
  if (!isSome(tag)) return true;
  return item.tags.includes(tag.value);
}

function nextTag(current: Option<string>, tag: string): Option<string> {
  if (isSome(current) && current.value === tag) return none();
  return some(tag);
}

function nextFullscreenToolsFromTab(state: FullscreenToolsState): FullscreenToolsState {
  if (state === FULLSCREEN_TOOLS.PINNED) return FULLSCREEN_TOOLS.HIDDEN;
  return FULLSCREEN_TOOLS.PINNED;
}

function nextFullscreenToolsFromPin(state: FullscreenToolsState): FullscreenToolsState {
  if (state === FULLSCREEN_TOOLS.PINNED) return FULLSCREEN_TOOLS.HOVER_OPEN;
  return FULLSCREEN_TOOLS.PINNED;
}

function firstOption<T>(values: T[]): Option<T> {
  for (const value of values) {
    return some(value);
  }
  return none();
}

function findOption<T>(values: T[], predicate: (value: T) => boolean): Option<T> {
  for (const value of values) {
    if (predicate(value)) return some(value);
  }
  return none();
}

function selectedImageReset(model: Model): Model {
  return {
    ...model,
    rotation: 0,
    zoom: 1,
    collapsedXmlPaths: [],
    image: {
      naturalSize: none(),
      token: model.image.token + 1,
    },
  };
}

function invalidateProcessedImage(model: Model): Model {
  return {
    ...model,
    image: {
      ...model.image,
      token: model.image.token + 1,
    },
  };
}

function imageProcessCmd(model: Model): Cmd[] {
  if (!isSome(model.image.naturalSize)) return [];
  return [{ type: "SyncImageProcessing", token: model.image.token }];
}

function applyLayoutMetrics(model: Model, metrics: LayoutMetrics): Model {
  return {
    ...model,
    layout: clampLayout({ ...model.layout, previewViewport: some(metrics.previewViewport) }, metrics),
  };
}

function resizePanel(
  model: Model,
  target: ResizeTarget,
  value: number,
  metrics: LayoutMetrics,
): Model {
  const layout = { ...model.layout };
  if (target === "filters") layout.filtersWidth = some(value);
  if (target === "results") layout.resultsWidth = some(value);
  if (target === "preview") layout.previewHeight = some(value);
  return {
    ...model,
    layout: clampLayout({ ...layout, previewViewport: some(metrics.previewViewport) }, metrics),
  };
}

function clampLayout(layout: LayoutState, metrics: LayoutMetrics): LayoutState {
  const available = metrics.workspaceWidth - MIN_DETAIL_WIDTH - HANDLE_WIDTH_TOTAL;
  if (available < MIN_FILTERS_WIDTH + MIN_RESULTS_WIDTH) {
    return {
      ...layout,
      previewHeight: clampPreviewHeight(layout.previewHeight, metrics),
    };
  }

  let filtersWidth = clamp(optionValueOr(layout.filtersWidth, 260), MIN_FILTERS_WIDTH, 600);
  let resultsWidth = clamp(optionValueOr(layout.resultsWidth, 420), MIN_RESULTS_WIDTH, 760);

  const overflow = filtersWidth + resultsWidth - available;
  if (overflow > 0) {
    const reducedResults = Math.max(MIN_RESULTS_WIDTH, resultsWidth - overflow);
    const remainingOverflow = overflow - (resultsWidth - reducedResults);
    resultsWidth = reducedResults;
    filtersWidth = Math.max(MIN_FILTERS_WIDTH, filtersWidth - remainingOverflow);
  }

  return {
    ...layout,
    filtersWidth: some(Math.round(filtersWidth)),
    resultsWidth: some(Math.round(resultsWidth)),
    previewHeight: clampPreviewHeight(layout.previewHeight, metrics),
  };
}

function clampPreviewHeight(value: Option<number>, metrics: LayoutMetrics): Option<number> {
  if (!isSome(value)) return none();
  const reservedHeight = metrics.detailHeadHeight + MIN_DETAIL_INFO_HEIGHT + 64;
  const maxPreviewHeight = Math.max(MIN_PREVIEW_HEIGHT, metrics.detailHeight - reservedHeight);
  return some(Math.round(clamp(value.value, MIN_PREVIEW_HEIGHT, maxPreviewHeight)));
}

function toggleString(values: string[], target: string): string[] {
  if (values.includes(target)) {
    return values.filter((value) => value !== target);
  }
  return [...values, target];
}

function normalizeRotation(value: number): number {
  return ((value % 360) + 360) % 360;
}

function fieldPathOptions(path: string): string[] {
  const segments = fieldPathSegments(path);
  const options: string[] = [];
  segments.forEach((_, index) => {
    options.push(segments.slice(0, index + 1).join("/"));
  });
  return options;
}

function normalizeFieldPath(path: string): string {
  return fieldPathSegments(path).join("/");
}

function fieldPathSegments(path: string): string[] {
  return path
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function countBy<T>(values: T[], keyFn: (value: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  values.forEach((value) => {
    const key = keyFn(value);
    counts.set(key, mapCount(counts, key) + 1);
  });
  return counts;
}

function mapCount(counts: Map<string, number>, key: string): number {
  if (counts.has(key)) return counts.get(key) as number;
  return 0;
}
