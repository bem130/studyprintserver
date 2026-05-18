import { TONE_MODES, clamp, nextToneMode, normalizeFitMode, normalizeToneMode, toneIsInverted, } from "./viewer-core.js";
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 4;
export const ZOOM_STEP = 0.25;
export const MIN_FILTERS_WIDTH = 180;
export const MIN_RESULTS_WIDTH = 260;
export const MIN_DETAIL_WIDTH = 360;
export const MIN_PREVIEW_HEIGHT = 180;
export const MIN_TEXT_HEIGHT = 120;
export const HANDLE_WIDTH_TOTAL = 14;
export function initModel(settings) {
    const model = {
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
export function update(model, msg) {
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
            if (msg.token !== model.image.token)
                return [model, []];
            return [{ ...model, image: { ...model.image, processing: true } }, []];
        case "ImageProcessed":
            if (msg.token !== model.image.token)
                return [model, []];
            return [
                {
                    ...model,
                    image: { ...model.image, processedSize: msg.size, processing: false },
                },
                [{ type: "MeasureLayout" }],
            ];
        case "ImageProcessingCleared":
            if (msg.token !== model.image.token)
                return [model, []];
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
                        : [{ type: "Persist", key: "studyprint-preview-height", value: String(next.layout.previewHeight) }]),
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
        return ((!query || searchable.includes(query)) &&
            (!model.field || item.primary_field_path === model.field) &&
            (!model.date || item.logical_date === model.date) &&
            (!model.tag || item.tags.includes(model.tag)));
    });
}
export function selectedItem(model) {
    return model.items.find((item) => item.global_content_id === model.selectedId) ?? null;
}
export function metricValues(model) {
    return {
        contents: model.items.length,
        fields: new Set(model.items.map((item) => item.primary_field_ref)).size,
        formulas: model.items.reduce((sum, item) => sum + item.formula_count, 0),
    };
}
export function fieldCounts(model) {
    return countBy(model.items, (item) => item.primary_field_path);
}
export function dateCounts(model) {
    return countBy(model.items, (item) => item.logical_date);
}
export function tagCounts(model) {
    return countBy(model.items.flatMap((item) => item.tags), (tag) => tag);
}
export function activeSourceSize(model) {
    return needsCanvasProcessing(model) && model.image.processedSize
        ? model.image.processedSize
        : model.image.naturalSize;
}
export function needsCanvasProcessing(model) {
    return (toneIsInverted(model.imageTone, model.theme) ||
        model.autoNormalize ||
        model.brightness !== 0 ||
        model.contrast !== 0);
}
export function toneAdjustmentsActive(model) {
    return model.brightness !== 0 || model.contrast !== 0 || model.autoNormalize;
}
export function toneLabel(model) {
    if (model.imageTone === TONE_MODES.AUTO)
        return "Auto";
    if (model.imageTone === TONE_MODES.INVERTED)
        return "Invert";
    return "Paper";
}
function normalizeSelection(model) {
    const filtered = filteredItems(model);
    if (filtered.length === 0) {
        return selectedImageReset({ ...model, selectedId: null });
    }
    if (model.selectedId && filtered.some((item) => item.global_content_id === model.selectedId)) {
        return model;
    }
    return selectedImageReset({ ...model, selectedId: filtered[0]?.global_content_id ?? null });
}
function selectedImageReset(model) {
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
function imageToneReset(model) {
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
function imageProcessCmd(model) {
    if (!model.image.naturalSize)
        return [];
    return needsCanvasProcessing(model)
        ? [{ type: "ProcessImage", token: model.image.token }]
        : [{ type: "ProcessImage", token: model.image.token }];
}
function scheduleImageProcessCmd(model) {
    if (!model.image.naturalSize)
        return [];
    return [{ type: "ScheduleProcessImage", token: model.image.token }];
}
function applyLayoutMetrics(model, metrics) {
    return {
        ...model,
        layout: clampLayout({ ...model.layout, previewViewport: metrics.previewViewport }, metrics),
    };
}
function resizePanel(model, target, value, metrics) {
    const layout = { ...model.layout };
    if (target === "filters")
        layout.filtersWidth = value;
    if (target === "results")
        layout.resultsWidth = value;
    if (target === "preview")
        layout.previewHeight = value;
    return {
        ...model,
        layout: clampLayout({ ...layout, previewViewport: metrics.previewViewport }, metrics),
    };
}
function clampLayout(layout, metrics) {
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
function clampPreviewHeight(value, metrics) {
    if (value == null)
        return null;
    const reservedHeight = metrics.detailHeadHeight + metrics.detailTagsHeight + MIN_TEXT_HEIGHT + 64;
    const maxPreviewHeight = Math.max(MIN_PREVIEW_HEIGHT, metrics.detailHeight - reservedHeight);
    return Math.round(clamp(value, MIN_PREVIEW_HEIGHT, maxPreviewHeight));
}
function normalizeRotation(value) {
    return ((value % 360) + 360) % 360;
}
function countBy(values, keyFn) {
    const counts = new Map();
    values.forEach((value) => {
        const key = keyFn(value);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return counts;
}
