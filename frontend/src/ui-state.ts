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
import { err, isOk, isSome, none, ok, optionMap, optionValueOr, some, type Option, type Result } from "./option.js";
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
const RESULT_ROW_SNIPPET_LIMIT = 190;
const RESULT_ROW_SNIPPET_CONTEXT = 58;

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

export const SEARCH_MODES = {
  PLAIN: "plain",
  REGEX: "regex",
  FUZZY: "fuzzy",
} as const;

export type SearchMode = (typeof SEARCH_MODES)[keyof typeof SEARCH_MODES];

export const SEARCH_SCOPES = {
  ALL: "all",
  TITLE: "title",
  BODY: "body",
  META: "meta",
  TAGS: "tags",
  FIELD: "field",
  DATE: "date",
  FILENAME: "filename",
} as const;

export type SearchScope = (typeof SEARCH_SCOPES)[keyof typeof SEARCH_SCOPES];

export const SEARCH_ISSUES = {
  INVALID_REGEX: "invalid_regex",
} as const;

export type SearchIssueCode = (typeof SEARCH_ISSUES)[keyof typeof SEARCH_ISSUES];

export interface SearchIssue {
  code: SearchIssueCode;
  detail: string;
}

export interface AdvancedSearchState {
  query: string;
  mode: SearchMode;
  scope: SearchScope;
  caseSensitive: boolean;
}

export interface SearchHighlightSegment {
  text: string;
  highlighted: boolean;
}

export interface SearchHighlightSupplement {
  label: string;
  segments: SearchHighlightSegment[];
}

export interface ResultRowHighlights {
  title: SearchHighlightSegment[];
  meta: SearchHighlightSegment[];
  text: SearchHighlightSegment[];
  supplement: Option<SearchHighlightSupplement>;
}

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
  advancedSearch: AdvancedSearchState;
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
  detailBlockChrome: number;
  detailRowGap: number;
  previewHandleHeight: number;
  previewChrome: Size;
  previewViewport: Size;
}

export type ResizeTarget = "filters" | "results" | "preview";

export type Msg =
  | { type: "ContentsLoaded"; items: StudyPrintItem[] }
  | { type: "ContentsFailed"; message: string }
  | { type: "AdvancedSearchQueryChanged"; value: string }
  | { type: "AdvancedSearchModeChanged"; mode: SearchMode }
  | { type: "AdvancedSearchScopeChanged"; scope: SearchScope }
  | { type: "AdvancedSearchCaseSensitivityChanged"; caseSensitive: boolean }
  | { type: "ResetAdvancedSearch" }
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
    advancedSearch: {
      query: "",
      mode: SEARCH_MODES.PLAIN,
      scope: SEARCH_SCOPES.ALL,
      caseSensitive: false,
    },
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
    case "AdvancedSearchQueryChanged":
      return [normalizeSelection({ ...model, advancedSearch: { ...model.advancedSearch, query: msg.value } }), []];
    case "AdvancedSearchModeChanged":
      return [normalizeSelection({ ...model, advancedSearch: { ...model.advancedSearch, mode: msg.mode } }), []];
    case "AdvancedSearchScopeChanged":
      return [normalizeSelection({ ...model, advancedSearch: { ...model.advancedSearch, scope: msg.scope } }), []];
    case "AdvancedSearchCaseSensitivityChanged":
      return [
        normalizeSelection({
          ...model,
          advancedSearch: { ...model.advancedSearch, caseSensitive: msg.caseSensitive },
        }),
        [],
      ];
    case "ResetAdvancedSearch":
      return [
        normalizeSelection({
          ...model,
          advancedSearch: {
            query: "",
            mode: SEARCH_MODES.PLAIN,
            scope: SEARCH_SCOPES.ALL,
            caseSensitive: false,
          },
        }),
        [],
      ];
    case "FieldChanged":
      return [normalizeSelection({ ...model, field: msg.value }), []];
    case "DateChanged":
      return [normalizeSelection({ ...model, date: msg.value }), []];
    case "TagToggled":
      return [normalizeSelection({ ...model, tag: nextTag(model.tag, msg.tag) }), []];
    case "SelectItem":
      return [selectItem(model, msg.id), [{ type: "MeasureLayout" }]];
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
      return [next, [{ type: "MeasureLayout" }]];
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
  const matcher = advancedSearchMatcher(model.advancedSearch);
  return model.items.filter((item) => {
    return (
      advancedSearchMatches(matcher, item) &&
      fieldMatches(model.field, item) &&
      dateMatches(model.date, item) &&
      tagMatches(model.tag, item)
    );
  });
}

export function advancedSearchIssue(model: Model): Option<SearchIssue> {
  const matcher = advancedSearchMatcher(model.advancedSearch);
  if (isOk(matcher)) return none();
  return some(matcher.error);
}

export function searchIssueText(issue: SearchIssue): string {
  switch (issue.code) {
    case SEARCH_ISSUES.INVALID_REGEX:
      return `Invalid regular expression: ${issue.detail}`;
  }
}

export function resultRowHighlights(search: AdvancedSearchState, item: StudyPrintItem): ResultRowHighlights {
  const bodyText = resultRowBodyText(search, item);
  return {
    title: highlightVisibleResultText(search, "title", item.title),
    meta: highlightVisibleResultText(search, "meta", resultRowMetaText(item)),
    text: highlightVisibleResultText(search, "body", bodyText),
    supplement: resultRowSupplement(search, item, bodyText),
  };
}

export function resultRowMetaText(item: StudyPrintItem): string {
  return `${item.logical_date} / ${item.primary_field_path}`;
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

export function searchModeFromValue(value: string): Option<SearchMode> {
  switch (value) {
    case SEARCH_MODES.PLAIN:
      return some(SEARCH_MODES.PLAIN);
    case SEARCH_MODES.REGEX:
      return some(SEARCH_MODES.REGEX);
    case SEARCH_MODES.FUZZY:
      return some(SEARCH_MODES.FUZZY);
  }
  return none();
}

export function searchScopeFromValue(value: string): Option<SearchScope> {
  switch (value) {
    case SEARCH_SCOPES.ALL:
      return some(SEARCH_SCOPES.ALL);
    case SEARCH_SCOPES.TITLE:
      return some(SEARCH_SCOPES.TITLE);
    case SEARCH_SCOPES.BODY:
      return some(SEARCH_SCOPES.BODY);
    case SEARCH_SCOPES.META:
      return some(SEARCH_SCOPES.META);
    case SEARCH_SCOPES.TAGS:
      return some(SEARCH_SCOPES.TAGS);
    case SEARCH_SCOPES.FIELD:
      return some(SEARCH_SCOPES.FIELD);
    case SEARCH_SCOPES.DATE:
      return some(SEARCH_SCOPES.DATE);
    case SEARCH_SCOPES.FILENAME:
      return some(SEARCH_SCOPES.FILENAME);
  }
  return none();
}

function normalizeSelection(model: Model): Model {
  const filtered = filteredItems(model);
  if (filtered.length === 0) {
    return selectItem(model, none());
  }
  if (isSome(model.selectedId)) {
    const selectedId = model.selectedId.value;
    if (filtered.some((item) => item.global_content_id === selectedId)) {
      return model;
    }
  }
  const first = firstOption(filtered);
  return selectItem(model, optionMap(first, (item) => item.global_content_id));
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

type AdvancedMatcher =
  | {
      type: typeof SEARCH_MODES.PLAIN;
      scope: SearchScope;
      needle: string;
      compactNeedle: string;
      caseSensitive: boolean;
    }
  | { type: typeof SEARCH_MODES.REGEX; scope: SearchScope; pattern: RegExp }
  | {
      type: typeof SEARCH_MODES.FUZZY;
      scope: SearchScope;
      needle: string;
      compactNeedle: string;
      caseSensitive: boolean;
    };

interface SearchSource {
  title: string;
  body: string;
  meta: string;
  tags: string;
  field: string;
  date: string;
  filename: string;
  all: string;
}

type ResultVisibleField = "title" | "meta" | "body";

interface TextRange {
  start: number;
  end: number;
}

interface CompactText {
  text: string;
  ranges: TextRange[];
}

function advancedSearchMatcher(search: AdvancedSearchState): Result<Option<AdvancedMatcher>, SearchIssue> {
  const query = search.query.trim();
  if (query.length === 0) return ok(none());
  switch (search.mode) {
    case SEARCH_MODES.PLAIN:
      return ok(
        some({
          type: SEARCH_MODES.PLAIN,
          scope: search.scope,
          needle: normalizeSearchText(query, search.caseSensitive),
          compactNeedle: compactSearchText(query, search.caseSensitive),
          caseSensitive: search.caseSensitive,
        }),
      );
    case SEARCH_MODES.REGEX:
      return regexMatcher(query, search.scope, search.caseSensitive);
    case SEARCH_MODES.FUZZY:
      return ok(
        some({
          type: SEARCH_MODES.FUZZY,
          scope: search.scope,
          needle: normalizeSearchText(query, search.caseSensitive),
          compactNeedle: compactSearchText(query, search.caseSensitive),
          caseSensitive: search.caseSensitive,
        }),
      );
  }
}

function regexMatcher(
  query: string,
  scope: SearchScope,
  caseSensitive: boolean,
): Result<Option<AdvancedMatcher>, SearchIssue> {
  try {
    const flags = caseSensitive ? "u" : "iu";
    return ok(some({ type: SEARCH_MODES.REGEX, scope, pattern: new RegExp(query, flags) }));
  } catch (error) {
    return err({
      code: SEARCH_ISSUES.INVALID_REGEX,
      detail: errorText(error),
    });
  }
}

function advancedSearchMatches(
  matcherResult: Result<Option<AdvancedMatcher>, SearchIssue>,
  item: StudyPrintItem,
): boolean {
  if (!isOk(matcherResult)) return false;
  if (!isSome(matcherResult.value)) return true;
  const source = searchSource(item);
  const haystack = sourceForScope(source, matcherResult.value.value.scope);
  return matcherMatches(matcherResult.value.value, haystack);
}

function searchSource(item: StudyPrintItem): SearchSource {
  const filename = [pathFileName(item.image_url), pathFileName(item.xml_url)].join(" ");
  const tags = item.tags.join(" ");
  const field = item.primary_field_path;
  const date = item.logical_date;
  const body = [item.text, xmlBodyText(item.xml_text)].join(" ");
  const meta = [
    item.print_id,
    item.global_content_id,
    date,
    field,
    tags,
    filename,
  ].join(" ");
  const all = [item.title, body, meta, filename, xmlVisibleText(item.xml_text)].join(" ");
  return { title: item.title, body, meta, tags, field, date, filename, all };
}

function sourceForScope(source: SearchSource, scope: SearchScope): string {
  switch (scope) {
    case SEARCH_SCOPES.ALL:
      return source.all;
    case SEARCH_SCOPES.TITLE:
      return source.title;
    case SEARCH_SCOPES.BODY:
      return source.body;
    case SEARCH_SCOPES.META:
      return source.meta;
    case SEARCH_SCOPES.TAGS:
      return source.tags;
    case SEARCH_SCOPES.FIELD:
      return source.field;
    case SEARCH_SCOPES.DATE:
      return source.date;
    case SEARCH_SCOPES.FILENAME:
      return source.filename;
  }
}

function resultRowBodyText(search: AdvancedSearchState, item: StudyPrintItem): string {
  const source = resultRowBodySource(search, item);
  return snippetForPlainSearch(source, search, RESULT_ROW_SNIPPET_LIMIT);
}

function resultRowBodySource(search: AdvancedSearchState, item: StudyPrintItem): string {
  const candidates = uniqueNonEmptyStrings([inlineText(item.text), inlineText(xmlBodyText(item.xml_text))]);
  if (search.mode === SEARCH_MODES.PLAIN && searchScopeIncludes(search.scope, SEARCH_SCOPES.BODY)) {
    const matched = findOption(candidates, (candidate) => hasPlainHighlight(search, candidate));
    if (isSome(matched)) return matched.value;
  }
  return optionValueOr(firstOption(candidates), "");
}

function resultRowSupplement(
  search: AdvancedSearchState,
  item: StudyPrintItem,
  visibleBodyText: string,
): Option<SearchHighlightSupplement> {
  if (search.mode !== SEARCH_MODES.PLAIN) return none();
  if (!isSome(plainSearchNeedle(search))) return none();
  if (hasVisibleResultHighlight(search, item, visibleBodyText)) return none();

  const candidates = supplementalSearchSources(search.scope, item);
  for (const candidate of candidates) {
    const text = inlineText(candidate.text);
    if (hasPlainHighlight(search, text)) {
      return some({
        label: candidate.label,
        segments: highlightPlainSearch(search, snippetForPlainSearch(text, search, RESULT_ROW_SNIPPET_LIMIT)),
      });
    }
  }

  return none();
}

function hasVisibleResultHighlight(
  search: AdvancedSearchState,
  item: StudyPrintItem,
  visibleBodyText: string,
): boolean {
  return (
    (visibleFieldMatchesScope("title", search.scope) && hasPlainHighlight(search, item.title)) ||
    (visibleFieldMatchesScope("meta", search.scope) && hasPlainHighlight(search, resultRowMetaText(item))) ||
    (visibleFieldMatchesScope("body", search.scope) && hasPlainHighlight(search, visibleBodyText))
  );
}

function supplementalSearchSources(
  scope: SearchScope,
  item: StudyPrintItem,
): Array<{ label: string; text: string }> {
  const source = searchSource(item);
  if (scope === SEARCH_SCOPES.TAGS) return [{ label: "Tags", text: source.tags }];
  if (scope === SEARCH_SCOPES.FILENAME) return [{ label: "File", text: source.filename }];
  if (scope === SEARCH_SCOPES.META) return [{ label: "Meta", text: source.meta }];
  if (scope === SEARCH_SCOPES.ALL) {
    return [
      { label: "Tags", text: source.tags },
      { label: "File", text: source.filename },
    ];
  }
  return [];
}

function highlightVisibleResultText(
  search: AdvancedSearchState,
  field: ResultVisibleField,
  text: string,
): SearchHighlightSegment[] {
  if (!visibleFieldMatchesScope(field, search.scope)) return plainHighlightSegments(text);
  return highlightPlainSearch(search, text);
}

function visibleFieldMatchesScope(field: ResultVisibleField, scope: SearchScope): boolean {
  if (scope === SEARCH_SCOPES.ALL) return true;
  if (field === "title") return scope === SEARCH_SCOPES.TITLE;
  if (field === "body") return scope === SEARCH_SCOPES.BODY;
  return scope === SEARCH_SCOPES.META || scope === SEARCH_SCOPES.FIELD || scope === SEARCH_SCOPES.DATE;
}

function searchScopeIncludes(scope: SearchScope, target: SearchScope): boolean {
  return scope === SEARCH_SCOPES.ALL || scope === target;
}

function snippetForPlainSearch(text: string, search: AdvancedSearchState, limit: number): string {
  const display = inlineText(text);
  if (display.length <= limit) return display;
  const range = firstPlainHighlightRange(search, display);
  if (!isSome(range)) return `${display.slice(0, limit).trim()}...`;

  const maxStart = Math.max(0, display.length - limit);
  let start = Math.max(0, range.value.start - RESULT_ROW_SNIPPET_CONTEXT);
  start = Math.min(start, maxStart);
  const end = Math.min(display.length, start + limit);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < display.length ? "..." : "";
  return `${prefix}${display.slice(start, end).trim()}${suffix}`;
}

function highlightPlainSearch(search: AdvancedSearchState, text: string): SearchHighlightSegment[] {
  const ranges = plainHighlightRanges(search, text);
  if (ranges.length === 0) return plainHighlightSegments(text);

  const segments: SearchHighlightSegment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      segments.push({ text: text.slice(cursor, range.start), highlighted: false });
    }
    if (range.end > range.start) {
      segments.push({ text: text.slice(range.start, range.end), highlighted: true });
    }
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), highlighted: false });
  }
  return segments;
}

function plainHighlightSegments(text: string): SearchHighlightSegment[] {
  return [{ text, highlighted: false }];
}

function hasPlainHighlight(search: AdvancedSearchState, text: string): boolean {
  return isSome(firstPlainHighlightRange(search, text));
}

function firstPlainHighlightRange(search: AdvancedSearchState, text: string): Option<TextRange> {
  const ranges = plainHighlightRanges(search, text);
  return firstOption(ranges);
}

function plainHighlightRanges(search: AdvancedSearchState, text: string): TextRange[] {
  const needle = plainSearchNeedle(search);
  if (!isSome(needle)) return [];

  const compact = compactTextWithRanges(text, search.caseSensitive);
  const ranges: TextRange[] = [];
  let start = 0;
  while (start < compact.text.length) {
    const found = indexOfOption(compact.text, needle.value, start);
    if (!isSome(found)) break;
    const range = compactRangeToSourceRange(compact, found.value, found.value + needle.value.length);
    if (isSome(range)) ranges.push(range.value);
    start = found.value + Math.max(1, needle.value.length);
  }
  return mergeTextRanges(ranges);
}

function plainSearchNeedle(search: AdvancedSearchState): Option<string> {
  if (search.mode !== SEARCH_MODES.PLAIN) return none();
  const needle = compactSearchText(search.query, search.caseSensitive);
  if (needle.length === 0) return none();
  return some(needle);
}

function compactTextWithRanges(text: string, caseSensitive: boolean): CompactText {
  const chars: string[] = [];
  const ranges: TextRange[] = [];
  let index = 0;
  for (const rawChar of text) {
    const normalized = normalizeSearchText(rawChar, caseSensitive).replace(/\s+/gu, "");
    for (const normalizedChar of normalized) {
      chars.push(normalizedChar);
      ranges.push({ start: index, end: index + rawChar.length });
    }
    index += rawChar.length;
  }
  return { text: chars.join(""), ranges };
}

function compactRangeToSourceRange(compact: CompactText, start: number, end: number): Option<TextRange> {
  const first = arrayItemOption(compact.ranges, start);
  const last = rangeBeforeIndex(compact.ranges, end);
  if (!isSome(first) || !isSome(last)) return none();
  return some({ start: first.value.start, end: last.value.end });
}

function mergeTextRanges(ranges: TextRange[]): TextRange[] {
  const merged: TextRange[] = [];
  for (const range of ranges) {
    const last = lastOption(merged);
    if (!isSome(last)) {
      merged.push(range);
    } else if (range.start <= last.value.end) {
      last.value.end = Math.max(last.value.end, range.end);
    } else {
      merged.push(range);
    }
  }
  return merged;
}

function rangeBeforeIndex<T>(values: T[], index: number): Option<T> {
  if (index <= 0) return none();
  return arrayItemOption(values, index - 1);
}

function arrayItemOption<T>(values: T[], index: number): Option<T> {
  if (index < 0) return none();
  if (index >= values.length) return none();
  return some(values[index] as T);
}

function indexOfOption(haystack: string, needle: string, start: number): Option<number> {
  const index = haystack.indexOf(needle, start);
  if (index < 0) return none();
  return some(index);
}

function uniqueNonEmptyStrings(values: string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    if (value.length > 0 && !result.includes(value)) result.push(value);
  }
  return result;
}

function inlineText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function matcherMatches(matcher: AdvancedMatcher, source: string): boolean {
  switch (matcher.type) {
    case SEARCH_MODES.PLAIN:
      return plainSearchMatches(matcher.needle, matcher.compactNeedle, source, matcher.caseSensitive);
    case SEARCH_MODES.REGEX:
      matcher.pattern.lastIndex = 0;
      return matcher.pattern.test(source);
    case SEARCH_MODES.FUZZY:
      return fuzzySearchMatches(matcher.needle, matcher.compactNeedle, source, matcher.caseSensitive);
  }
}

function plainSearchMatches(needle: string, compactNeedle: string, source: string, caseSensitive: boolean): boolean {
  const normalized = normalizeSearchText(source, caseSensitive);
  if (normalized.includes(needle)) return true;
  return compactSearchText(source, caseSensitive).includes(compactNeedle);
}

function fuzzySearchMatches(needle: string, compactNeedle: string, source: string, caseSensitive: boolean): boolean {
  if (plainSearchMatches(needle, compactNeedle, source, caseSensitive)) return true;
  if (compactNeedle.length < 2) return false;
  return withinEditDistance(compactNeedle, compactSearchText(source, caseSensitive), fuzzyThreshold(compactNeedle.length));
}

function fuzzyThreshold(length: number): number {
  if (length <= 5) return 1;
  if (length <= 10) return 2;
  return 3;
}

function withinEditDistance(needle: string, haystack: string, threshold: number): boolean {
  if (needle.length === 0) return true;
  if (haystack.length === 0) return false;
  const minWindow = Math.max(1, needle.length - threshold);
  const maxWindow = needle.length + threshold;
  for (let start = 0; start < haystack.length; start += 1) {
    for (let windowLength = minWindow; windowLength <= maxWindow; windowLength += 1) {
      const end = start + windowLength;
      if (end > haystack.length) continue;
      if (levenshteinWithin(needle, haystack.slice(start, end), threshold)) return true;
    }
  }
  return false;
}

function levenshteinWithin(left: string, right: string, threshold: number): boolean {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = current[0] as number;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      const deletion = (previous[rightIndex] as number) + 1;
      const insertion = (current[rightIndex - 1] as number) + 1;
      const substitution = (previous[rightIndex - 1] as number) + cost;
      const value = Math.min(deletion, insertion, substitution);
      current[rightIndex] = value;
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > threshold) return false;
    for (let index = 0; index < current.length; index += 1) {
      previous[index] = current[index] as number;
    }
  }
  return (previous[right.length] as number) <= threshold;
}

function normalizeSearchText(value: string, caseSensitive: boolean): string {
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (caseSensitive) return normalized;
  return normalized.toLocaleLowerCase("ja-JP");
}

function compactSearchText(value: string, caseSensitive: boolean): string {
  return normalizeSearchText(value, caseSensitive).replace(/\s+/gu, "");
}

function xmlBodyText(xml: string): string {
  const open = nullableOption(/<body\b[^>]*>/u.exec(xml));
  if (!isSome(open)) return "";
  const start = open.value.index + open.value[0].length;
  const rest = xml.slice(start);
  const close = nullableOption(/<\/body>/u.exec(rest));
  if (!isSome(close)) return xmlVisibleText(rest);
  return xmlVisibleText(rest.slice(0, close.value.index));
}

function xmlVisibleText(xml: string): string {
  return decodeBasicEntities(
    xml
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, " $1 ")
      .replace(/<[^>]+>/gu, " "),
  ).replace(/\s+/gu, " ");
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'");
}

function pathFileName(path: string): string {
  const parts = path.split("/").filter((part) => part.length > 0);
  const last = lastOption(parts);
  return optionValueOr(last, path);
}

function lastOption<T>(values: T[]): Option<T> {
  if (values.length === 0) return none();
  return some(values[values.length - 1] as T);
}

function nullableOption<T>(value: T | null): Option<T> {
  return value === null ? none() : some(value);
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
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

function selectItem(model: Model, selectedId: Option<string>): Model {
  const previousImage = selectedImageUrl(model);
  const selected = {
    ...model,
    selectedId,
    rotation: 0,
    zoom: 1,
    collapsedXmlPaths: [],
  };
  const nextImage = selectedImageUrl(selected);
  if (optionStringSame(previousImage, nextImage)) {
    return selected;
  }
  return selectedImageReset(selected);
}

function selectedImageUrl(model: Model): Option<string> {
  const item = selectedItem(model);
  return optionMap(item, (value) => value.image_url);
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
  const previewHeight = clampPreviewHeight(layout.previewHeight, metrics);
  const previewViewport = previewViewportForHeight(metrics, previewHeight);
  const available = metrics.workspaceWidth - MIN_DETAIL_WIDTH - HANDLE_WIDTH_TOTAL;
  if (available < MIN_FILTERS_WIDTH + MIN_RESULTS_WIDTH) {
    return {
      ...layout,
      previewHeight,
      previewViewport: some(previewViewport),
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
    previewHeight,
    previewViewport: some(previewViewport),
  };
}

function clampPreviewHeight(value: Option<number>, metrics: LayoutMetrics): Option<number> {
  if (!isSome(value)) return none();
  const reservedHeight =
    metrics.detailHeadHeight +
    MIN_DETAIL_INFO_HEIGHT +
    metrics.detailBlockChrome +
    metrics.previewHandleHeight +
    metrics.detailRowGap * 3;
  const maxPreviewHeight = Math.max(MIN_PREVIEW_HEIGHT, metrics.detailHeight - reservedHeight);
  return some(Math.round(clamp(value.value, MIN_PREVIEW_HEIGHT, maxPreviewHeight)));
}

function previewViewportForHeight(metrics: LayoutMetrics, previewHeight: Option<number>): Size {
  if (!isSome(previewHeight)) return metrics.previewViewport;
  return {
    width: metrics.previewViewport.width,
    height: Math.max(120, Math.round(previewHeight.value - metrics.previewChrome.height)),
  };
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

function optionStringSame(left: Option<string>, right: Option<string>): boolean {
  if (!isSome(left) && !isSome(right)) return true;
  return isSome(left) && isSome(right) && left.value === right.value;
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
