import { FIT_MODES, THEMES, TONE_MODES, clamp, nextTheme, nextToneMode, normalizeToneBrightness, normalizeToneContrast, toneHasAdjustments, toneRequiresCanvas, } from "./viewer-core.js";
import { isSome, none, optionMap, optionValueOr, some } from "./option.js";
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
export function initModel() {
    const model = {
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
        case "SearchChanged":
            return [normalizeSelection({ ...model, search: msg.value }), []];
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
        return (queryMatches(query, searchable) &&
            fieldMatches(model.field, item) &&
            dateMatches(model.date, item) &&
            tagMatches(model.tag, item));
    });
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
function queryMatches(query, searchable) {
    if (query.length === 0)
        return true;
    return searchable.includes(query);
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
