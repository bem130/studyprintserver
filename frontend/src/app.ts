import {
  FIT_MODES,
  TONE_MODES,
  adjustedLightness,
  lightnessRangeFromHistogram,
  mediaLayout,
  oklabToDisplaySrgb,
  sourceLightness,
  srgbToOklab,
  toneIsInverted,
  type LightnessRange,
  type Size,
  type ToneOptions,
} from "./viewer-core.js";
import {
  HANDLE_WIDTH_TOTAL,
  MAX_ZOOM,
  MIN_DETAIL_WIDTH,
  MIN_FILTERS_WIDTH,
  MIN_RESULTS_WIDTH,
  MIN_ZOOM,
  ZOOM_STEP,
  activeSourceSize,
  dateCounts,
  fieldCounts,
  filteredItems,
  initModel,
  metricValues,
  needsCanvasProcessing,
  selectedItem,
  tagCounts,
  toneAdjustmentsActive,
  toneLabel,
  update,
  type Cmd,
  type LayoutMetrics,
  type Model,
  type Msg,
  type ResizeTarget,
  type StoredSettings,
  type StudyPrintItem,
} from "./ui-state.js";
import { h, mount, patch, type VChild, type VNode } from "./vdom.js";

const MAX_PROCESSED_PIXELS = 7_000_000;
const HISTOGRAM_BINS = 256;
const AUTO_LOW_PERCENTILE = 0.01;
const AUTO_HIGH_PERCENTILE = 0.99;
const PROCESS_CHUNK_BYTES = 220_000 * 4;

type Dispatch = (msg: Msg) => void;

let imageProcessTimer: number | null = null;
let model: Model;
let tree: VNode | null = null;

const root = qs<HTMLElement>("#app");
const [initialModel, initialCmds] = initModel(readStoredSettings());
model = initialModel;
renderApp();
runCmds(initialCmds);

document.addEventListener("fullscreenchange", () => {
  dispatch({
    type: "FullscreenChanged",
    active: document.fullscreenElement === qs<HTMLElement>("#previewPane"),
  });
});

window.addEventListener("resize", () => {
  dispatch({ type: "LayoutMeasured", metrics: readLayoutMetrics() });
});

function dispatch(msg: Msg): void {
  const [nextModel, cmds] = update(model, msg);
  model = nextModel;
  renderApp();
  runCmds(cmds);
}

function renderApp(): void {
  const nextTree = view(model, dispatch);
  tree = tree ? patch(root, tree, nextTree) : mount(root, nextTree);
}

function runCmds(cmds: Cmd[]): void {
  for (const cmd of cmds) {
    runCmd(cmd);
  }
}

function runCmd(cmd: Cmd): void {
  switch (cmd.type) {
    case "LoadContents":
      void loadContents();
      break;
    case "MeasureLayout":
      requestAnimationFrame(() => {
        dispatch({ type: "LayoutMeasured", metrics: readLayoutMetrics() });
      });
      break;
    case "ApplyTheme":
      document.documentElement.dataset.theme = cmd.theme;
      break;
    case "Persist":
      localStorage.setItem(cmd.key, cmd.value);
      break;
    case "RemovePersisted":
      localStorage.removeItem(cmd.key);
      break;
    case "ProcessImage":
      void processImage(cmd.token);
      break;
    case "ScheduleProcessImage":
      if (imageProcessTimer !== null) window.clearTimeout(imageProcessTimer);
      imageProcessTimer = window.setTimeout(() => {
        void processImage(cmd.token);
      }, 90);
      break;
    case "ToggleFullscreen":
      void toggleFullscreen();
      break;
  }
}

async function loadContents(): Promise<void> {
  try {
    const response = await fetch("/api/contents");
    if (!response.ok) {
      throw new Error(`failed to load contents: ${response.status}`);
    }
    dispatch({ type: "ContentsLoaded", items: (await response.json()) as StudyPrintItem[] });
  } catch (error: unknown) {
    dispatch({
      type: "ContentsFailed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function view(current: Model, send: Dispatch): VNode {
  return h(
    "div",
    { class: "shell" },
    viewTopbar(current, send),
    h(
      "main",
      {
        id: "workspace",
        class: "workspace",
        style: workspaceStyle(current),
      },
      viewFilters(current, send),
      resizeHandle("filterResize", "Resize filters", "vertical", (event) =>
        beginResize(event, "filters"),
      ),
      viewResults(current, send),
      resizeHandle("resultsResize", "Resize results", "vertical", (event) =>
        beginResize(event, "results"),
      ),
      viewDetail(current, send),
    ),
  );
}

function viewTopbar(current: Model, send: Dispatch): VNode {
  const metrics = metricValues(current);
  return h(
    "header",
    { class: "topbar" },
    h("div", { class: "brand-block" }, h("h1", {}, "StudyPrint Viewer"), h("p", { id: "statusLine" }, current.status)),
    h(
      "div",
      { class: "topbar-right" },
      h(
        "div",
        { class: "metrics", "aria-label": "summary" },
        metricCard("metricContents", metrics.contents, "contents"),
        metricCard("metricFields", metrics.fields, "fields"),
        metricCard("metricFormulas", metrics.formulas, "formulas"),
      ),
      toolButton(themeLabel(current), {
        id: "themeToggle",
        wide: true,
        active: current.theme === "dark",
        title: "Toggle theme",
        onClick: () => send({ type: "ToggleTheme" }),
      }),
    ),
  );
}

function metricCard(id: string, value: number, label: string): VNode {
  return h("div", {}, h("span", { id }, String(value)), h("small", {}, label));
}

function viewFilters(current: Model, send: Dispatch): VNode {
  return h(
    "aside",
    { id: "filtersPanel", class: "filters", "aria-label": "filters" },
    h(
      "label",
      { class: "filter-block" },
      h("span", {}, "Search"),
      h("input", {
        id: "searchInput",
        type: "search",
        autocomplete: "off",
        value: current.search,
        onInput: (event: Event) =>
          send({ type: "SearchChanged", value: (event.currentTarget as HTMLInputElement).value }),
      }),
    ),
    selectFilter("fieldSelect", "Field", "All fields", current.field, fieldCounts(current), (value) =>
      send({ type: "FieldChanged", value }),
    ),
    selectFilter("dateSelect", "Date", "All dates", current.date, dateCounts(current), (value) =>
      send({ type: "DateChanged", value }),
    ),
    h(
      "div",
      { class: "filter-block" },
      h("span", {}, "Tags"),
      h(
        "div",
        { id: "tagList", class: "tag-list" },
        ...[...tagCounts(current).entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"))
          .slice(0, 28)
          .map(([tag, count]) =>
            h(
              "button",
              {
                key: tag,
                type: "button",
                class: classNames("tag-button", current.tag === tag && "active"),
                onClick: () => send({ type: "TagToggled", tag }),
              },
              `${tag} ${count}`,
            ),
          ),
      ),
    ),
  );
}

function selectFilter(
  id: string,
  label: string,
  allLabel: string,
  value: string,
  counts: Map<string, number>,
  onChange: (value: string) => void,
): VNode {
  return h(
    "label",
    { class: "filter-block" },
    h("span", {}, label),
    h(
      "select",
      {
        id,
        value,
        onChange: (event: Event) => onChange((event.currentTarget as HTMLSelectElement).value),
      },
      h("option", { value: "" }, allLabel),
      ...[...counts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], "ja"))
        .map(([optionValue, count]) =>
          h("option", { key: optionValue, value: optionValue }, `${optionValue} (${count})`),
        ),
    ),
  );
}

function viewResults(current: Model, send: Dispatch): VNode {
  const items = filteredItems(current);
  return h(
    "section",
    { id: "resultsPanel", class: "results", "aria-label": "contents" },
    h("div", { class: "results-head" }, h("strong", { id: "resultCount" }, String(items.length)), h("span", {}, " matches")),
    h(
      "div",
      { id: "contentList", class: "content-list" },
      items.length === 0
        ? h("div", { class: "empty" }, "No matching pages.")
        : items.map((item) => viewResultRow(current, item, send)),
    ),
  );
}

function viewResultRow(current: Model, item: StudyPrintItem, send: Dispatch): VNode {
  return h(
    "button",
    {
      key: item.global_content_id,
      type: "button",
      class: classNames("content-row", item.global_content_id === current.selectedId && "active"),
      onClick: () => send({ type: "SelectItem", id: item.global_content_id }),
    },
    h("div", { class: "row-title" }, item.title),
    h("div", { class: "row-meta" }, `${item.logical_date} / ${item.primary_field_path}`),
    h("div", { class: "row-text" }, item.text.slice(0, 160)),
  );
}

function viewDetail(current: Model, send: Dispatch): VNode {
  const item = selectedItem(current);
  return h(
    "section",
    {
      id: "detailPanel",
      class: "detail",
      "aria-label": "detail",
      style: detailStyle(current),
    },
    h(
      "header",
      { class: "detail-head" },
      h(
        "div",
        { class: "detail-title-block" },
        h("h2", { id: "detailTitle" }, item?.title ?? "Select a page"),
        h(
          "p",
          { id: "detailMeta" },
          item ? `${item.print_id} / ${item.logical_date} / ${item.primary_field_path}` : "",
        ),
      ),
      viewDetailTools(current, send),
    ),
    viewPreview(current, item, send),
    resizeHandle("previewResize", "Resize preview", "horizontal", (event) =>
      beginResize(event, "preview"),
    ),
    h(
      "div",
      { id: "detailTags", class: "detail-tags" },
      ...(item?.tags ?? []).map((tag) => h("span", { key: tag, class: "tag" }, tag)),
    ),
    h("pre", { id: "detailText" }, item?.text ?? ""),
  );
}

function viewDetailTools(current: Model, send: Dispatch): VNode {
  return h(
    "div",
    { class: "detail-tools", "aria-label": "image tools" },
    h(
      "div",
      { class: "tool-row" },
      toolButton("L", { title: "Rotate left", onClick: () => send({ type: "RotateBy", degrees: -90 }) }),
      toolButton("R", { title: "Rotate right", onClick: () => send({ type: "RotateBy", degrees: 90 }) }),
      toolButton("-", {
        title: "Zoom out",
        disabled: current.zoom <= MIN_ZOOM,
        onClick: () => send({ type: "ZoomBy", delta: -ZOOM_STEP }),
      }),
      toolButton("+", {
        title: "Zoom in",
        disabled: current.zoom >= MAX_ZOOM,
        onClick: () => send({ type: "ZoomBy", delta: ZOOM_STEP }),
      }),
      toolButton("Reset", { id: "resetView", wide: true, onClick: () => send({ type: "ResetView" }) }),
      toolButton(toneLabel(current), {
        id: "imageToneToggle",
        wide: true,
        active: toneIsInverted(current.imageTone, current.theme),
        onClick: () => send({ type: "CycleTone" }),
      }),
      toolButton(current.fullscreen ? "Exit" : "Full", {
        id: "fullscreenButton",
        wide: true,
        active: current.fullscreen,
        onClick: () => send({ type: "RequestFullscreenToggle" }),
      }),
      h(
        "a",
        {
          id: "openImage",
          class: "image-link",
          href: selectedItem(current)?.image_url ?? "#",
          target: "_blank",
          rel: "noreferrer",
        },
        "Open",
      ),
    ),
    h(
      "div",
      { class: "tool-row" },
      fitButton("Width", FIT_MODES.WIDTH, current, send),
      fitButton("Height", FIT_MODES.HEIGHT, current, send),
      fitButton("Page", FIT_MODES.BOTH, current, send),
      toolButton("Norm", {
        id: "normalizeToggle",
        wide: true,
        active: current.autoNormalize,
        onClick: () => send({ type: "ToggleNormalize" }),
      }),
      toolButton("Tone 0", {
        id: "resetToneAdjust",
        wide: true,
        active: toneAdjustmentsActive(current),
        onClick: () => send({ type: "ResetToneAdjustments" }),
      }),
    ),
    viewAdjustRow(current, send, false),
  );
}

function viewPreview(current: Model, item: StudyPrintItem | null, send: Dispatch): VNode {
  const imageLayout = currentImageLayout(current);
  const processedVisible = needsCanvasProcessing(current) && Boolean(current.image.processedSize);
  return h(
    "section",
    {
      id: "previewPane",
      class: classNames(
        "preview",
        imageLayout?.overflowX && "overflow-x",
        imageLayout?.overflowY && "overflow-y",
        current.image.processing && "tone-processing",
        processedVisible && "tone-processed",
      ),
      "aria-label": "image preview",
    },
    h(
      "div",
      {
        id: "imageStage",
        class: "image-stage",
        style: imageStageStyle(current, imageLayout),
      },
      h("img", {
        id: "detailImage",
        alt: item?.title ?? "",
        src: item?.image_url ?? null,
        style: mediaStyle(imageLayout),
        onLoad: (event: Event) => {
          const image = event.currentTarget as HTMLImageElement;
          send({
            type: "ImageLoaded",
            size: { width: image.naturalWidth, height: image.naturalHeight },
          });
        },
      }),
      h("canvas", {
        id: "darkImageCanvas",
        "aria-hidden": "true",
        style: mediaStyle(imageLayout),
      }),
    ),
    viewFullscreenTools(current, send),
  );
}

function viewFullscreenTools(current: Model, send: Dispatch): VNode {
  return h(
    "div",
    {
      id: "fullscreenTools",
      class: classNames(
        "fullscreen-tools",
        current.fullscreenToolsHidden && "tools-hidden",
        current.fullscreenToolsPinned && !current.fullscreenToolsHidden && "tools-pinned",
      ),
    },
    h(
      "button",
      {
        id: "fullscreenToolbarTab",
        class: "fullscreen-tab",
        type: "button",
        title: "Show or hide fullscreen tools",
        onClick: () => send({ type: "ToggleFullscreenTools" }),
      },
      "Tools",
    ),
    h(
      "div",
      { class: "fullscreen-panel", "aria-label": "fullscreen tools" },
      h(
        "div",
        { class: "fullscreen-panel-head" },
        h("span", {}, "Tools"),
        toolButton("Pin", {
          id: "fullscreenPin",
          wide: true,
          active: current.fullscreenToolsPinned && !current.fullscreenToolsHidden,
          onClick: () => send({ type: "ToggleFullscreenToolsPin" }),
        }),
        toolButton("Hide", { wide: true, onClick: () => send({ type: "HideFullscreenTools" }) }),
      ),
      h(
        "div",
        { class: "tool-row" },
        toolButton("L", { onClick: () => send({ type: "RotateBy", degrees: -90 }) }),
        toolButton("R", { onClick: () => send({ type: "RotateBy", degrees: 90 }) }),
        toolButton("-", { onClick: () => send({ type: "ZoomBy", delta: -ZOOM_STEP }) }),
        toolButton("+", { onClick: () => send({ type: "ZoomBy", delta: ZOOM_STEP }) }),
        toolButton("Reset", { wide: true, onClick: () => send({ type: "ResetView" }) }),
      ),
      h(
        "div",
        { class: "tool-row" },
        fitButton("Width", FIT_MODES.WIDTH, current, send),
        fitButton("Height", FIT_MODES.HEIGHT, current, send),
        fitButton("Page", FIT_MODES.BOTH, current, send),
      ),
      h(
        "div",
        { class: "tool-row" },
        toolButton(themeLabel(current), {
          wide: true,
          active: current.theme === "dark",
          onClick: () => send({ type: "ToggleTheme" }),
        }),
        toolButton(toneLabel(current), {
          wide: true,
          active: toneIsInverted(current.imageTone, current.theme),
          onClick: () => send({ type: "CycleTone" }),
        }),
        toolButton("Norm", {
          wide: true,
          active: current.autoNormalize,
          onClick: () => send({ type: "ToggleNormalize" }),
        }),
        toolButton("Exit", { wide: true, active: current.fullscreen, onClick: () => send({ type: "RequestFullscreenToggle" }) }),
      ),
      viewAdjustRow(current, send, true),
    ),
  );
}

function viewAdjustRow(current: Model, send: Dispatch, fullscreen: boolean): VNode {
  return h(
    "div",
    { class: classNames("adjust-row", fullscreen && "fullscreen-adjust") },
    rangeControl(fullscreen ? "fsBrightnessRange" : "brightnessRange", "Light", current.brightness, -60, 60, (value) =>
      send({ type: "BrightnessChanged", value }),
    ),
    rangeControl(fullscreen ? "fsContrastRange" : "contrastRange", "Contrast", current.contrast, -60, 100, (value) =>
      send({ type: "ContrastChanged", value }),
    ),
    fullscreen
      ? toolButton("Tone 0", {
          wide: true,
          active: toneAdjustmentsActive(current),
          onClick: () => send({ type: "ResetToneAdjustments" }),
        })
      : null,
  );
}

function rangeControl(
  id: string,
  label: string,
  value: number,
  min: number,
  max: number,
  onInput: (value: number) => void,
): VNode {
  return h(
    "label",
    { class: "range-control" },
    h("span", {}, label),
    h("input", {
      id,
      type: "range",
      min: String(min),
      max: String(max),
      value: String(value),
      onInput: (event: Event) => onInput(Number((event.currentTarget as HTMLInputElement).value)),
    }),
  );
}

function fitButton(label: string, mode: typeof FIT_MODES[keyof typeof FIT_MODES], current: Model, send: Dispatch): VNode {
  return toolButton(label, {
    wide: true,
    active: current.fitMode === mode,
    onClick: () => send({ type: "SetFitMode", mode }),
  });
}

function toolButton(
  label: string,
  options: {
    id?: string;
    wide?: boolean;
    active?: boolean;
    disabled?: boolean;
    title?: string;
    onClick?: (event: Event) => void;
  },
): VNode {
  const props: Record<string, unknown> = {
    class: classNames("tool-button", options.wide && "wide", options.active && "active"),
    type: "button",
  };
  if (options.id) props.id = options.id;
  if (options.title) props.title = options.title;
  if (options.disabled != null) props.disabled = options.disabled;
  if (options.onClick) props.onClick = options.onClick;
  return h("button", props, label);
}

function resizeHandle(
  id: string,
  label: string,
  orientation: "vertical" | "horizontal",
  onPointerDown: (event: PointerEvent) => void,
): VNode {
  return h("div", {
    id,
    class: classNames("resize-handle", `resize-handle-${orientation}`),
    role: "separator",
    "aria-label": label,
    "aria-orientation": orientation,
    tabindex: "0",
    onPointerDown,
    onKeyDown: (event: KeyboardEvent) => resizeWithKeyboard(event, orientation, id),
  });
}

function resizeWithKeyboard(event: KeyboardEvent, orientation: "vertical" | "horizontal", id: string): void {
  const negativeKey = orientation === "horizontal" ? "ArrowUp" : "ArrowLeft";
  const positiveKey = orientation === "horizontal" ? "ArrowDown" : "ArrowRight";
  if (event.key !== negativeKey && event.key !== positiveKey) return;

  event.preventDefault();
  const delta = event.key === positiveKey ? 24 : -24;
  const target: ResizeTarget =
    id === "filterResize" ? "filters" : id === "resultsResize" ? "results" : "preview";
  const currentValue =
    target === "filters"
      ? currentFiltersWidth()
      : target === "results"
        ? currentResultsWidth()
        : currentPreviewHeight();
  dispatch({
    type: "ResizePanel",
    target,
    value: currentValue + delta,
    metrics: readLayoutMetrics(),
  });
}

function currentImageLayout(current: Model) {
  const source = activeSourceSize(current);
  const viewport = current.layout.previewViewport;
  if (!source || !viewport) return null;
  return mediaLayout(source, viewport, {
    fitMode: current.fitMode,
    rotation: current.rotation,
    zoom: current.zoom,
  });
}

function workspaceStyle(current: Model): Record<string, string> {
  const style: Record<string, string> = {};
  if (current.layout.filtersWidth != null) style["--filters-width"] = `${current.layout.filtersWidth}px`;
  if (current.layout.resultsWidth != null) style["--results-width"] = `${current.layout.resultsWidth}px`;
  return style;
}

function detailStyle(current: Model): Record<string, string> {
  return current.layout.previewHeight == null
    ? {}
    : { "--preview-height": `${current.layout.previewHeight}px` };
}

function imageStageStyle(current: Model, layout: ReturnType<typeof currentImageLayout>): Record<string, string> {
  return {
    "--rotation": `${current.rotation}deg`,
    width: layout ? `${layout.stageWidth}px` : "1px",
    height: layout ? `${layout.stageHeight}px` : "1px",
  };
}

function mediaStyle(layout: ReturnType<typeof currentImageLayout>): Record<string, string> {
  return layout
    ? { width: `${layout.mediaWidth}px`, height: `${layout.mediaHeight}px` }
    : { width: "1px", height: "1px" };
}

function beginResize(event: PointerEvent, target: ResizeTarget): void {
  if (event.button !== 0) return;

  const startX = event.clientX;
  const startY = event.clientY;
  const startFilters = currentFiltersWidth();
  const startResults = currentResultsWidth();
  const startPreview = currentPreviewHeight();
  const horizontal = target === "preview";

  document.body.classList.add(horizontal ? "resizing-y" : "resizing-x");
  event.preventDefault();

  const onMove = (moveEvent: PointerEvent) => {
    const value =
      target === "filters"
        ? startFilters + (moveEvent.clientX - startX)
        : target === "results"
          ? startResults + (moveEvent.clientX - startX)
          : startPreview + (moveEvent.clientY - startY);
    dispatch({
      type: "ResizePanel",
      target,
      value,
      metrics: readLayoutMetrics(),
    });
  };

  const finish = () => {
    document.body.classList.remove("resizing-x", "resizing-y");
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", finish);
    document.removeEventListener("pointercancel", finish);
  };

  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", finish);
  document.addEventListener("pointercancel", finish);
}

function readLayoutMetrics(): LayoutMetrics {
  const preview = qs<HTMLElement>("#previewPane");
  const padding = document.fullscreenElement === preview ? 40 : 24;
  return {
    workspaceWidth: qs<HTMLElement>("#workspace").clientWidth,
    detailHeight: qs<HTMLElement>("#detailPanel").clientHeight,
    detailHeadHeight: qs<HTMLElement>(".detail-head").getBoundingClientRect().height,
    detailTagsHeight: qs<HTMLElement>("#detailTags").getBoundingClientRect().height,
    previewViewport: {
      width: Math.max(120, preview.clientWidth - padding),
      height: Math.max(120, preview.clientHeight - padding),
    },
    verticalHandlesVisible: getComputedStyle(qs<HTMLElement>("#filterResize")).display !== "none",
  };
}

function currentFiltersWidth(): number {
  return Math.round(
    model.layout.filtersWidth ?? qs<HTMLElement>("#filtersPanel").getBoundingClientRect().width,
  );
}

function currentResultsWidth(): number {
  return Math.round(
    model.layout.resultsWidth ?? qs<HTMLElement>("#resultsPanel").getBoundingClientRect().width,
  );
}

function currentPreviewHeight(): number {
  return Math.round(
    model.layout.previewHeight ?? qs<HTMLElement>("#previewPane").getBoundingClientRect().height,
  );
}

async function processImage(token: number): Promise<void> {
  if (token !== model.image.token) return;

  const image = qs<HTMLImageElement>("#detailImage");
  const canvas = qs<HTMLCanvasElement>("#darkImageCanvas");
  if (!image.complete || !image.naturalWidth) return;

  if (!needsCanvasProcessing(model)) {
    canvas.width = 0;
    canvas.height = 0;
    dispatch({ type: "ImageProcessingCleared", token });
    return;
  }

  const options: ToneOptions = {
    inverted: toneIsInverted(model.imageTone, model.theme),
    autoNormalize: model.autoNormalize,
    brightness: model.brightness,
    contrast: model.contrast,
  };

  dispatch({ type: "ImageProcessingStarted", token });
  await nextFrame();
  if (token !== model.image.token) return;

  const size = scaledCanvasSize(image.naturalWidth, image.naturalHeight);
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    dispatch({ type: "ImageProcessingCleared", token });
    return;
  }

  context.drawImage(image, 0, 0, size.width, size.height);
  const imageData = context.getImageData(0, 0, size.width, size.height);
  const completed = await processLightnessPreserveHue(imageData.data, token, options);
  if (!completed || token !== model.image.token) return;

  context.putImageData(imageData, 0, 0);
  dispatch({ type: "ImageProcessed", token, size });
}

function scaledCanvasSize(width: number, height: number): Size {
  const pixels = width * height;
  if (pixels <= MAX_PROCESSED_PIXELS) return { width, height };
  const scale = Math.sqrt(MAX_PROCESSED_PIXELS / pixels);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function processLightnessPreserveHue(
  data: Uint8ClampedArray,
  token: number,
  options: ToneOptions,
): Promise<boolean> {
  const histogram = options.autoNormalize
    ? await buildLightnessHistogram(data, token, options)
    : null;
  if (options.autoNormalize && !histogram) return false;

  const range = histogram
    ? lightnessRangeFromHistogram(
        histogram,
        data.length / 4,
        AUTO_LOW_PERCENTILE,
        AUTO_HIGH_PERCENTILE,
      )
    : { low: 0, high: 1 };
  return writeLightnessAdjustedPixels(data, token, options, range);
}

async function buildLightnessHistogram(
  data: Uint8ClampedArray,
  token: number,
  options: ToneOptions,
): Promise<Uint32Array | null> {
  const histogram = new Uint32Array(HISTOGRAM_BINS);
  for (let i = 0; i < data.length; i += 4) {
    const lab = srgbToOklab(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0);
    const lightness = sourceLightness(lab.l, options.inverted);
    const bin = Math.min(
      HISTOGRAM_BINS - 1,
      Math.max(0, Math.round(lightness * (HISTOGRAM_BINS - 1))),
    );
    histogram[bin] = (histogram[bin] ?? 0) + 1;
    if (i > 0 && i % PROCESS_CHUNK_BYTES === 0) {
      await nextFrame();
      if (token !== model.image.token) return null;
    }
  }
  return histogram;
}

async function writeLightnessAdjustedPixels(
  data: Uint8ClampedArray,
  token: number,
  options: ToneOptions,
  range: LightnessRange,
): Promise<boolean> {
  for (let i = 0; i < data.length; i += 4) {
    const lab = srgbToOklab(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0);
    const adjustedL = adjustedLightness(
      sourceLightness(lab.l, options.inverted),
      options,
      range,
    );
    const rgb = oklabToDisplaySrgb(adjustedL, lab.a, lab.b);
    data[i] = rgb.r;
    data[i + 1] = rgb.g;
    data[i + 2] = rgb.b;
    if (i > 0 && i % PROCESS_CHUNK_BYTES === 0) {
      await nextFrame();
      if (token !== model.image.token) return false;
    }
  }
  return true;
}

async function toggleFullscreen(): Promise<void> {
  try {
    const preview = qs<HTMLElement>("#previewPane");
    if (document.fullscreenElement === preview) {
      await document.exitFullscreen();
    } else {
      await preview.requestFullscreen();
    }
  } catch (error: unknown) {
    dispatch({
      type: "ContentsFailed",
      message: `Fullscreen failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

function readStoredSettings(): StoredSettings {
  return {
    theme: localStorage.getItem("studyprint-theme"),
    imageTone: localStorage.getItem("studyprint-image-tone"),
    fitMode: localStorage.getItem("studyprint-fit-mode"),
    brightness: loadNumberSetting("studyprint-brightness", -60, 60),
    contrast: loadNumberSetting("studyprint-contrast", -60, 100),
    autoNormalize: localStorage.getItem("studyprint-auto-normalize") === "1",
    filtersWidth: loadNumberSetting("studyprint-filters-width", 160, 600),
    resultsWidth: loadNumberSetting("studyprint-results-width", 220, 760),
    previewHeight: loadNumberSetting("studyprint-preview-height", 160, 900),
  };
}

function loadNumberSetting(key: string, min: number, max: number): number | null {
  const raw = localStorage.getItem(key);
  if (raw == null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? clampLocal(value, min, max) : null;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function themeLabel(current: Model): string {
  return current.theme === "dark" ? "Light" : "Dark";
}

function classNames(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}

function clampLocal(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function qs<T extends Element>(selector: string, context: ParentNode = document): T {
  const element = context.querySelector(selector);
  if (!element) throw new Error(`missing element: ${selector}`);
  return element as T;
}
