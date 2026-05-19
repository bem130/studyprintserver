import { FIT_MODES, THEMES, TONE_MODES, clamp, nextTheme, nextToneMode, normalizeToneBrightness, normalizeToneContrast, toneHasAdjustments, toneRequiresCanvas, } from "./viewer-core.js";
import { err, isOk, isSome, none, ok, optionMap, optionValueOr, some } from "./option.js";
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
};
export const FULLSCREEN_TARGETS = {
    PREVIEW: "preview",
    BODY: "body",
};
export const DETAIL_TABS = {
    BODY: "body",
    XML_TREE: "xml_tree",
    XML_RAW: "xml_raw",
};
export const SEARCH_MODES = {
    PLAIN: "plain",
    REGEX: "regex",
    FUZZY: "fuzzy",
};
export const SEARCH_SCOPES = {
    ALL: "all",
    TITLE: "title",
    BODY: "body",
    META: "meta",
    TAGS: "tags",
    FIELD: "field",
    DATE: "date",
    FILENAME: "filename",
};
export const SEARCH_ISSUES = {
    INVALID_REGEX: "invalid_regex",
};
export function initModel() {
    const model = {
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
export function update(model, msg) {
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
                    fullscreenTools: model.fullscreenTools === FULLSCREEN_TOOLS.HOVER_READY
                        ? FULLSCREEN_TOOLS.HOVER_OPEN
                        : model.fullscreenTools,
                },
                [],
            ];
        case "FullscreenToolsPointerLeft":
            return [
                {
                    ...model,
                    fullscreenTools: model.fullscreenTools === FULLSCREEN_TOOLS.HOVER_OPEN
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
export function filteredItems(model) {
    const matcher = advancedSearchMatcher(model.advancedSearch);
    return model.items.filter((item) => {
        return (advancedSearchMatches(matcher, item) &&
            fieldMatches(model.field, item) &&
            dateMatches(model.date, item) &&
            tagMatches(model.tag, item));
    });
}
export function advancedSearchIssue(model) {
    const matcher = advancedSearchMatcher(model.advancedSearch);
    if (isOk(matcher))
        return none();
    return some(matcher.error);
}
export function searchIssueText(issue) {
    switch (issue.code) {
        case SEARCH_ISSUES.INVALID_REGEX:
            return `Invalid regular expression: ${issue.detail}`;
    }
}
export function selectedItem(model) {
    if (!isSome(model.selectedId))
        return none();
    const selectedId = model.selectedId.value;
    return findOption(model.items, (candidate) => candidate.global_content_id === selectedId);
}
export function metricValues(model) {
    return {
        contents: model.items.length,
        fields: new Set(model.items.map((item) => item.primary_field_path)).size,
        formulas: model.items.reduce((sum, item) => sum + item.formula_count, 0),
    };
}
export function fieldCounts(model) {
    const counts = new Map();
    model.items.forEach((item) => {
        fieldPathOptions(item.primary_field_path).forEach((path) => {
            counts.set(path, mapCount(counts, path) + 1);
        });
    });
    return counts;
}
export function dateCounts(model) {
    return countBy(model.items, (item) => item.logical_date);
}
export function tagCounts(model) {
    return countBy(model.items.flatMap((item) => item.tags), (tag) => tag);
}
export function activeSourceSize(model) {
    return model.image.naturalSize;
}
export function needsCanvasProcessing(model) {
    return toneRequiresCanvas(model.tone, model.theme);
}
export function toneAdjustmentsActive(model) {
    return toneHasAdjustments(model.tone);
}
export function toneLabel(model) {
    if (model.tone.mode === TONE_MODES.AUTO)
        return "Auto";
    if (model.tone.mode === TONE_MODES.INVERTED)
        return "Invert";
    return "Paper";
}
export function searchModeFromValue(value) {
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
export function searchScopeFromValue(value) {
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
function normalizeSelection(model) {
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
function fieldMatches(field, item) {
    if (!isSome(field))
        return true;
    const selected = normalizeFieldPath(field.value);
    if (selected.length === 0)
        return true;
    const itemPath = normalizeFieldPath(item.primary_field_path);
    return itemPath === selected || itemPath.startsWith(`${selected}/`);
}
function dateMatches(date, item) {
    if (!isSome(date))
        return true;
    return item.logical_date === date.value;
}
function tagMatches(tag, item) {
    if (!isSome(tag))
        return true;
    return item.tags.includes(tag.value);
}
function nextTag(current, tag) {
    if (isSome(current) && current.value === tag)
        return none();
    return some(tag);
}
function advancedSearchMatcher(search) {
    const query = search.query.trim();
    if (query.length === 0)
        return ok(none());
    switch (search.mode) {
        case SEARCH_MODES.PLAIN:
            return ok(some({
                type: SEARCH_MODES.PLAIN,
                scope: search.scope,
                needle: normalizeSearchText(query, search.caseSensitive),
                compactNeedle: compactSearchText(query, search.caseSensitive),
                caseSensitive: search.caseSensitive,
            }));
        case SEARCH_MODES.REGEX:
            return regexMatcher(query, search.scope, search.caseSensitive);
        case SEARCH_MODES.FUZZY:
            return ok(some({
                type: SEARCH_MODES.FUZZY,
                scope: search.scope,
                needle: normalizeSearchText(query, search.caseSensitive),
                compactNeedle: compactSearchText(query, search.caseSensitive),
                caseSensitive: search.caseSensitive,
            }));
    }
}
function regexMatcher(query, scope, caseSensitive) {
    try {
        const flags = caseSensitive ? "u" : "iu";
        return ok(some({ type: SEARCH_MODES.REGEX, scope, pattern: new RegExp(query, flags) }));
    }
    catch (error) {
        return err({
            code: SEARCH_ISSUES.INVALID_REGEX,
            detail: errorText(error),
        });
    }
}
function advancedSearchMatches(matcherResult, item) {
    if (!isOk(matcherResult))
        return false;
    if (!isSome(matcherResult.value))
        return true;
    const source = searchSource(item);
    const haystack = sourceForScope(source, matcherResult.value.value.scope);
    return matcherMatches(matcherResult.value.value, haystack);
}
function searchSource(item) {
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
function sourceForScope(source, scope) {
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
function matcherMatches(matcher, source) {
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
function plainSearchMatches(needle, compactNeedle, source, caseSensitive) {
    const normalized = normalizeSearchText(source, caseSensitive);
    if (normalized.includes(needle))
        return true;
    return compactSearchText(source, caseSensitive).includes(compactNeedle);
}
function fuzzySearchMatches(needle, compactNeedle, source, caseSensitive) {
    if (plainSearchMatches(needle, compactNeedle, source, caseSensitive))
        return true;
    if (compactNeedle.length < 2)
        return false;
    return withinEditDistance(compactNeedle, compactSearchText(source, caseSensitive), fuzzyThreshold(compactNeedle.length));
}
function fuzzyThreshold(length) {
    if (length <= 5)
        return 1;
    if (length <= 10)
        return 2;
    return 3;
}
function withinEditDistance(needle, haystack, threshold) {
    if (needle.length === 0)
        return true;
    if (haystack.length === 0)
        return false;
    const minWindow = Math.max(1, needle.length - threshold);
    const maxWindow = needle.length + threshold;
    for (let start = 0; start < haystack.length; start += 1) {
        for (let windowLength = minWindow; windowLength <= maxWindow; windowLength += 1) {
            const end = start + windowLength;
            if (end > haystack.length)
                continue;
            if (levenshteinWithin(needle, haystack.slice(start, end), threshold))
                return true;
        }
    }
    return false;
}
function levenshteinWithin(left, right, threshold) {
    const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
        const current = [leftIndex];
        let rowMinimum = current[0];
        for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
            const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
            const deletion = previous[rightIndex] + 1;
            const insertion = current[rightIndex - 1] + 1;
            const substitution = previous[rightIndex - 1] + cost;
            const value = Math.min(deletion, insertion, substitution);
            current[rightIndex] = value;
            rowMinimum = Math.min(rowMinimum, value);
        }
        if (rowMinimum > threshold)
            return false;
        for (let index = 0; index < current.length; index += 1) {
            previous[index] = current[index];
        }
    }
    return previous[right.length] <= threshold;
}
function normalizeSearchText(value, caseSensitive) {
    const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
    if (caseSensitive)
        return normalized;
    return normalized.toLocaleLowerCase("ja-JP");
}
function compactSearchText(value, caseSensitive) {
    return normalizeSearchText(value, caseSensitive).replace(/\s+/gu, "");
}
function xmlBodyText(xml) {
    const open = nullableOption(/<body\b[^>]*>/u.exec(xml));
    if (!isSome(open))
        return "";
    const start = open.value.index + open.value[0].length;
    const rest = xml.slice(start);
    const close = nullableOption(/<\/body>/u.exec(rest));
    if (!isSome(close))
        return xmlVisibleText(rest);
    return xmlVisibleText(rest.slice(0, close.value.index));
}
function xmlVisibleText(xml) {
    return decodeBasicEntities(xml
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, " $1 ")
        .replace(/<[^>]+>/gu, " ")).replace(/\s+/gu, " ");
}
function decodeBasicEntities(value) {
    return value
        .replace(/&lt;/gu, "<")
        .replace(/&gt;/gu, ">")
        .replace(/&amp;/gu, "&")
        .replace(/&quot;/gu, '"')
        .replace(/&apos;/gu, "'");
}
function pathFileName(path) {
    const parts = path.split("/").filter((part) => part.length > 0);
    const last = lastOption(parts);
    return optionValueOr(last, path);
}
function lastOption(values) {
    if (values.length === 0)
        return none();
    return some(values[values.length - 1]);
}
function nullableOption(value) {
    return value === null ? none() : some(value);
}
function errorText(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
function nextFullscreenToolsFromTab(state) {
    if (state === FULLSCREEN_TOOLS.PINNED)
        return FULLSCREEN_TOOLS.HIDDEN;
    return FULLSCREEN_TOOLS.PINNED;
}
function nextFullscreenToolsFromPin(state) {
    if (state === FULLSCREEN_TOOLS.PINNED)
        return FULLSCREEN_TOOLS.HOVER_OPEN;
    return FULLSCREEN_TOOLS.PINNED;
}
function firstOption(values) {
    for (const value of values) {
        return some(value);
    }
    return none();
}
function findOption(values, predicate) {
    for (const value of values) {
        if (predicate(value))
            return some(value);
    }
    return none();
}
function selectedImageReset(model) {
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
function selectItem(model, selectedId) {
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
function selectedImageUrl(model) {
    const item = selectedItem(model);
    return optionMap(item, (value) => value.image_url);
}
function invalidateProcessedImage(model) {
    return {
        ...model,
        image: {
            ...model.image,
            token: model.image.token + 1,
        },
    };
}
function imageProcessCmd(model) {
    if (!isSome(model.image.naturalSize))
        return [];
    return [{ type: "SyncImageProcessing", token: model.image.token }];
}
function applyLayoutMetrics(model, metrics) {
    return {
        ...model,
        layout: clampLayout({ ...model.layout, previewViewport: some(metrics.previewViewport) }, metrics),
    };
}
function resizePanel(model, target, value, metrics) {
    const layout = { ...model.layout };
    if (target === "filters")
        layout.filtersWidth = some(value);
    if (target === "results")
        layout.resultsWidth = some(value);
    if (target === "preview")
        layout.previewHeight = some(value);
    return {
        ...model,
        layout: clampLayout({ ...layout, previewViewport: some(metrics.previewViewport) }, metrics),
    };
}
function clampLayout(layout, metrics) {
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
function clampPreviewHeight(value, metrics) {
    if (!isSome(value))
        return none();
    const reservedHeight = metrics.detailHeadHeight + MIN_DETAIL_INFO_HEIGHT + 64;
    const maxPreviewHeight = Math.max(MIN_PREVIEW_HEIGHT, metrics.detailHeight - reservedHeight);
    return some(Math.round(clamp(value.value, MIN_PREVIEW_HEIGHT, maxPreviewHeight)));
}
function toggleString(values, target) {
    if (values.includes(target)) {
        return values.filter((value) => value !== target);
    }
    return [...values, target];
}
function normalizeRotation(value) {
    return ((value % 360) + 360) % 360;
}
function optionStringSame(left, right) {
    if (!isSome(left) && !isSome(right))
        return true;
    return isSome(left) && isSome(right) && left.value === right.value;
}
function fieldPathOptions(path) {
    const segments = fieldPathSegments(path);
    const options = [];
    segments.forEach((_, index) => {
        options.push(segments.slice(0, index + 1).join("/"));
    });
    return options;
}
function normalizeFieldPath(path) {
    return fieldPathSegments(path).join("/");
}
function fieldPathSegments(path) {
    return path
        .split("/")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
}
function countBy(values, keyFn) {
    const counts = new Map();
    values.forEach((value) => {
        const key = keyFn(value);
        counts.set(key, mapCount(counts, key) + 1);
    });
    return counts;
}
function mapCount(counts, key) {
    if (counts.has(key))
        return counts.get(key);
    return 0;
}
