import {
  FIT_MODES,
  TONE_MODES,
  clamp,
  nextToneMode,
  normalizeFitMode,
  normalizeToneMode,
  toneIsInverted,
  type FitMode,
  type Size,
  type ToneMode,
} from "./viewer-core.js";
import type { StudyPrintItem } from "./generated/api-types.js";

export type { StudyPrintItem };

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 4;
export const ZOOM_STEP = 0.25;
export const MIN_FILTERS_WIDTH = 180;
export const MIN_RESULTS_WIDTH = 260;
export const MIN_DETAIL_WIDTH = 360;
export const MIN_PREVIEW_HEIGHT = 180;
export const MIN_TEXT_HEIGHT = 120;
export const HANDLE_WIDTH_TOTAL = 14;

export interface LayoutState {
  filtersWidth: number | null;
  resultsWidth: number | null;
  previewHeight: number | null;
  previewViewport: Size | null;
}

export interface ImageState {
  naturalSize: Size | null;
  processedSize: Size | null;
  token: number;
  processing: boolean;
}

export interface Model {
  items: StudyPrintItem[];
  selectedId: string | null;
  status: string;
  error: string | null;
  search: string;
  field: string;
  date: string;
  tag: string;
  theme: "light" | "dark";
  imageTone: ToneMode;
  fitMode: FitMode;
  brightness: number;
  contrast: number;
  autoNormalize: boolean;
  rotation: number;
  zoom: number;
  fullscreen: boolean;
  fullscreenToolsPinned: boolean;
  fullscreenToolsHidden: boolean;
  layout: LayoutState;
  image: ImageState;
}

export interface StoredSettings {
  theme: string | null;
  imageTone: string | null;
  fitMode: string | null;
  brightness: number | null;
  contrast: number | null;
  autoNormalize: boolean;
  filtersWidth: number | null;
  resultsWidth: number | null;
  previewHeight: number | null;
}

export interface LayoutMetrics {
  workspaceWidth: number;
  detailHeight: number;
  detailHeadHeight: number;
  detailTagsHeight: number;
  previewViewport: Size;
  verticalHandlesVisible: boolean;
}

export type ResizeTarget = "filters" | "results" | "preview";

export type Msg =
  | { type: "ContentsLoaded"; items: StudyPrintItem[] }
  | { type: "ContentsFailed"; message: string }
  | { type: "SearchChanged"; value: string }
  | { type: "FieldChanged"; value: string }
  | { type: "DateChanged"; value: string }
  | { type: "TagToggled"; tag: string }
  | { type: "SelectItem"; id: string | null }
  | { type: "ToggleTheme" }
  | { type: "CycleTone" }
  | { type: "ToggleNormalize" }
  | { type: "ResetToneAdjustments" }
  | { type: "BrightnessChanged"; value: number }
  | { type: "ContrastChanged"; value: number }
  | { type: "RotateBy"; degrees: number }
  | { type: "ZoomBy"; delta: number }
  | { type: "SetFitMode"; mode: FitMode }
  | { type: "ResetView" }
  | { type: "ImageLoaded"; size: Size }
  | { type: "ImageProcessingStarted"; token: number }
  | { type: "ImageProcessed"; token: number; size: Size }
  | { type: "ImageProcessingCleared"; token: number }
  | { type: "LayoutMeasured"; metrics: LayoutMetrics }
  | { type: "ResizePanel"; target: ResizeTarget; value: number; metrics: LayoutMetrics }
  | { type: "FullscreenChanged"; active: boolean }
  | { type: "ToggleFullscreenTools" }
  | { type: "HideFullscreenTools" }
  | { type: "ToggleFullscreenToolsPin" }
  | { type: "RequestFullscreenToggle" };

export type Cmd =
  | { type: "LoadContents" }
  | { type: "MeasureLayout" }
  | { type: "ApplyTheme"; theme: "light" | "dark" }
  | { type: "Persist"; key: string; value: string }
  | { type: "RemovePersisted"; key: string }
  | { type: "ProcessImage"; token: number }
  | { type: "ScheduleProcessImage"; token: number }
  | { type: "ToggleFullscreen" };

export function initModel(settings: StoredSettings): [Model, Cmd[]] {
  const model: Model = {
    items: [],
    selectedId: null,
    status: "Loading index...",
    error: null,
    search: "",
    field: "",
    date: "",
    tag: "",
    theme: settings.theme === "dark" ? "dark" : "light",
    imageTone: normalizeToneMode(settings.imageTone),
    fitMode: normalizeFitMode(settings.fitMode),
    brightness: settings.brightness ?? 0,
    contrast: settings.contrast ?? 0,
    autoNormalize: settings.autoNormalize,
    rotation: 0,
    zoom: 1,
    fullscreen: false,
    fullscreenToolsPinned: false,
    fullscreenToolsHidden: false,
    layout: {
      filtersWidth: settings.filtersWidth,
      resultsWidth: settings.resultsWidth,
      previewHeight: settings.previewHeight,
      previewViewport: null,
    },
    image: {
      naturalSize: null,
      processedSize: null,
      token: 0,
      processing: false,
    },
  };
  return [model, [{ type: "ApplyTheme", theme: model.theme }, { type: "LoadContents" }, { type: "MeasureLayout" }]];
}

export function update(model: Model, msg: Msg): [Model, Cmd[]] {
  switch (msg.type) {
    case "ContentsLoaded": {
      const next = normalizeSelection({
        ...model,
        items: msg.items,
        status: "Index loaded",
        error: null,
      });
      return [next, [{ type: "MeasureLayout" }]];
    }
    case "ContentsFailed":
      return [{ ...model, status: msg.message, error: msg.message }, []];
    case "SearchChanged":
      return [normalizeSelection({ ...model, search: msg.value }), []];
    case "FieldChanged":
      return [normalizeSelection({ ...model, field: msg.value }), []];
    case "DateChanged":
      return [normalizeSelection({ ...model, date: msg.value }), []];
    case "TagToggled":
      return [normalizeSelection({ ...model, tag: model.tag === msg.tag ? "" : msg.tag }), []];
    case "SelectItem":
      return [selectedImageReset({ ...model, selectedId: msg.id }), [{ type: "MeasureLayout" }]];
    case "ToggleTheme": {
      const next = imageToneReset({
        ...model,
        theme: model.theme === "dark" ? "light" : "dark",
      });
      return [
        next,
        [
          { type: "ApplyTheme", theme: next.theme },
          { type: "Persist", key: "studyprint-theme", value: next.theme },
          ...imageProcessCmd(next),
        ],
      ];
    }
    case "CycleTone": {
      const next = imageToneReset({ ...model, imageTone: nextToneMode(model.imageTone) });
      return [
        next,
        [
          { type: "Persist", key: "studyprint-image-tone", value: next.imageTone },
          ...imageProcessCmd(next),
        ],
      ];
    }
    case "ToggleNormalize": {
      const next = imageToneReset({ ...model, autoNormalize: !model.autoNormalize });
      return [
        next,
        [
          { type: "Persist", key: "studyprint-auto-normalize", value: next.autoNormalize ? "1" : "0" },
          ...scheduleImageProcessCmd(next),
        ],
      ];
    }
    case "ResetToneAdjustments": {
      const next = imageToneReset({
        ...model,
        brightness: 0,
        contrast: 0,
        autoNormalize: false,
      });
      return [
        next,
        [
          { type: "Persist", key: "studyprint-brightness", value: "0" },
          { type: "Persist", key: "studyprint-contrast", value: "0" },
          { type: "RemovePersisted", key: "studyprint-auto-normalize" },
          ...scheduleImageProcessCmd(next),
        ],
      ];
    }
    case "BrightnessChanged": {
      const next = imageToneReset({
        ...model,
        brightness: clamp(msg.value, -60, 60),
      });
      return [
        next,
        [
          { type: "Persist", key: "studyprint-brightness", value: String(next.brightness) },
          ...scheduleImageProcessCmd(next),
        ],
      ];
    }
    case "ContrastChanged": {
      const next = imageToneReset({
        ...model,
        contrast: clamp(msg.value, -60, 100),
      });
      return [
        next,
        [
          { type: "Persist", key: "studyprint-contrast", value: String(next.contrast) },
          ...scheduleImageProcessCmd(next),
        ],
      ];
    }
    case "RotateBy":
      return [{ ...model, rotation: normalizeRotation(model.rotation + msg.degrees) }, []];
    case "ZoomBy":
      return [{ ...model, zoom: clamp(model.zoom + msg.delta, MIN_ZOOM, MAX_ZOOM) }, []];
    case "SetFitMode":
      return [
        { ...model, fitMode: msg.mode },
        [{ type: "Persist", key: "studyprint-fit-mode", value: msg.mode }],
      ];
    case "ResetView":
      return [{ ...model, rotation: 0, zoom: 1 }, []];
    case "ImageLoaded": {
      const next = imageToneReset({
        ...model,
        image: {
          naturalSize: msg.size,
          processedSize: null,
          token: model.image.token + 1,
          processing: false,
        },
      });
      return [next, [{ type: "MeasureLayout" }, ...imageProcessCmd(next)]];
    }
    case "ImageProcessingStarted":
      if (msg.token !== model.image.token) return [model, []];
      return [{ ...model, image: { ...model.image, processing: true } }, []];
    case "ImageProcessed":
      if (msg.token !== model.image.token) return [model, []];
      return [
        {
          ...model,
          image: { ...model.image, processedSize: msg.size, processing: false },
        },
        [{ type: "MeasureLayout" }],
      ];
    case "ImageProcessingCleared":
      if (msg.token !== model.image.token) return [model, []];
      return [
        {
          ...model,
          image: { ...model.image, processedSize: null, processing: false },
        },
        [{ type: "MeasureLayout" }],
      ];
    case "LayoutMeasured":
      return [applyLayoutMetrics(model, msg.metrics), []];
    case "ResizePanel": {
      const next = resizePanel(model, msg.target, msg.value, msg.metrics);
      return [
        next,
        [
          { type: "Persist", key: "studyprint-filters-width", value: String(next.layout.filtersWidth ?? "") },
          { type: "Persist", key: "studyprint-results-width", value: String(next.layout.resultsWidth ?? "") },
          ...(next.layout.previewHeight == null
            ? []
            : [{ type: "Persist", key: "studyprint-preview-height", value: String(next.layout.previewHeight) } as Cmd]),
        ],
      ];
    }
    case "FullscreenChanged":
      return [
        {
          ...model,
          fullscreen: msg.active,
          fullscreenToolsHidden: msg.active ? model.fullscreenToolsHidden : false,
        },
        [{ type: "MeasureLayout" }],
      ];
    case "ToggleFullscreenTools":
      return [
        {
          ...model,
          fullscreenToolsHidden: !model.fullscreenToolsHidden,
          fullscreenToolsPinned: model.fullscreenToolsHidden ? false : model.fullscreenToolsPinned,
        },
        [],
      ];
    case "HideFullscreenTools":
      return [{ ...model, fullscreenToolsHidden: true, fullscreenToolsPinned: false }, []];
    case "ToggleFullscreenToolsPin":
      return [
        {
          ...model,
          fullscreenToolsPinned: !model.fullscreenToolsPinned,
          fullscreenToolsHidden: false,
        },
        [],
      ];
    case "RequestFullscreenToggle":
      return [model, [{ type: "ToggleFullscreen" }]];
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
      (!query || searchable.includes(query)) &&
      (!model.field || item.primary_field_path === model.field) &&
      (!model.date || item.logical_date === model.date) &&
      (!model.tag || item.tags.includes(model.tag))
    );
  });
}

export function selectedItem(model: Model): StudyPrintItem | null {
  return model.items.find((item) => item.global_content_id === model.selectedId) ?? null;
}

export function metricValues(model: Model): { contents: number; fields: number; formulas: number } {
  return {
    contents: model.items.length,
    fields: new Set(model.items.map((item) => item.primary_field_ref)).size,
    formulas: model.items.reduce((sum, item) => sum + item.formula_count, 0),
  };
}

export function fieldCounts(model: Model): Map<string, number> {
  return countBy(model.items, (item) => item.primary_field_path);
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

export function activeSourceSize(model: Model): Size | null {
  return needsCanvasProcessing(model) && model.image.processedSize
    ? model.image.processedSize
    : model.image.naturalSize;
}

export function needsCanvasProcessing(model: Model): boolean {
  return (
    toneIsInverted(model.imageTone, model.theme) ||
    model.autoNormalize ||
    model.brightness !== 0 ||
    model.contrast !== 0
  );
}

export function toneAdjustmentsActive(model: Model): boolean {
  return model.brightness !== 0 || model.contrast !== 0 || model.autoNormalize;
}

export function toneLabel(model: Model): string {
  if (model.imageTone === TONE_MODES.AUTO) return "Auto";
  if (model.imageTone === TONE_MODES.INVERTED) return "Invert";
  return "Paper";
}

function normalizeSelection(model: Model): Model {
  const filtered = filteredItems(model);
  if (filtered.length === 0) {
    return selectedImageReset({ ...model, selectedId: null });
  }
  if (model.selectedId && filtered.some((item) => item.global_content_id === model.selectedId)) {
    return model;
  }
  return selectedImageReset({ ...model, selectedId: filtered[0]?.global_content_id ?? null });
}

function selectedImageReset(model: Model): Model {
  return {
    ...model,
    rotation: 0,
    zoom: 1,
    image: {
      naturalSize: null,
      processedSize: null,
      token: model.image.token + 1,
      processing: false,
    },
  };
}

function imageToneReset(model: Model): Model {
  return {
    ...model,
    image: {
      ...model.image,
      processedSize: null,
      token: model.image.token + 1,
      processing: false,
    },
  };
}

function imageProcessCmd(model: Model): Cmd[] {
  if (!model.image.naturalSize) return [];
  return needsCanvasProcessing(model)
    ? [{ type: "ProcessImage", token: model.image.token }]
    : [{ type: "ProcessImage", token: model.image.token }];
}

function scheduleImageProcessCmd(model: Model): Cmd[] {
  if (!model.image.naturalSize) return [];
  return [{ type: "ScheduleProcessImage", token: model.image.token }];
}

function applyLayoutMetrics(model: Model, metrics: LayoutMetrics): Model {
  return {
    ...model,
    layout: clampLayout({ ...model.layout, previewViewport: metrics.previewViewport }, metrics),
  };
}

function resizePanel(
  model: Model,
  target: ResizeTarget,
  value: number,
  metrics: LayoutMetrics,
): Model {
  const layout = { ...model.layout };
  if (target === "filters") layout.filtersWidth = value;
  if (target === "results") layout.resultsWidth = value;
  if (target === "preview") layout.previewHeight = value;
  return {
    ...model,
    layout: clampLayout({ ...layout, previewViewport: metrics.previewViewport }, metrics),
  };
}

function clampLayout(layout: LayoutState, metrics: LayoutMetrics): LayoutState {
  if (!metrics.verticalHandlesVisible) {
    return {
      ...layout,
      previewHeight: clampPreviewHeight(layout.previewHeight, metrics),
    };
  }

  const available = metrics.workspaceWidth - MIN_DETAIL_WIDTH - HANDLE_WIDTH_TOTAL;
  let filtersWidth = clamp(layout.filtersWidth ?? 260, MIN_FILTERS_WIDTH, 600);
  let resultsWidth = clamp(layout.resultsWidth ?? 420, MIN_RESULTS_WIDTH, 760);

  if (available >= MIN_FILTERS_WIDTH + MIN_RESULTS_WIDTH) {
    const overflow = filtersWidth + resultsWidth - available;
    if (overflow > 0) {
      const reducedResults = Math.max(MIN_RESULTS_WIDTH, resultsWidth - overflow);
      const remainingOverflow = overflow - (resultsWidth - reducedResults);
      resultsWidth = reducedResults;
      filtersWidth = Math.max(MIN_FILTERS_WIDTH, filtersWidth - remainingOverflow);
    }
  }

  return {
    ...layout,
    filtersWidth: Math.round(filtersWidth),
    resultsWidth: Math.round(resultsWidth),
    previewHeight: clampPreviewHeight(layout.previewHeight, metrics),
  };
}

function clampPreviewHeight(value: number | null, metrics: LayoutMetrics): number | null {
  if (value == null) return null;
  const reservedHeight =
    metrics.detailHeadHeight + metrics.detailTagsHeight + MIN_TEXT_HEIGHT + 64;
  const maxPreviewHeight = Math.max(MIN_PREVIEW_HEIGHT, metrics.detailHeight - reservedHeight);
  return Math.round(clamp(value, MIN_PREVIEW_HEIGHT, maxPreviewHeight));
}

function normalizeRotation(value: number): number {
  return ((value % 360) + 360) % 360;
}

function countBy<T>(values: T[], keyFn: (value: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  values.forEach((value) => {
    const key = keyFn(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return counts;
}
