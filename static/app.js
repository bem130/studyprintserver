import { FIT_MODES, THEMES, TONE_BRIGHTNESS_MAX, TONE_BRIGHTNESS_MIN, TONE_CONTRAST_MAX, TONE_CONTRAST_MIN, lightnessRangeFromHistogram, mediaLayout, sourceLightness, srgbToOklab, toneOptions, } from "./viewer-core.js";
import { DETAIL_TABS, FULLSCREEN_TARGETS, FULLSCREEN_TOOLS, MAX_ZOOM, MIN_ZOOM, SEARCH_MODES, SEARCH_SCOPES, ZOOM_STEP, activeSourceSize, advancedSearchIssue, dateCounts, fieldCounts, filteredItems, initModel, metricValues, needsCanvasProcessing, selectedItem, searchIssueText, searchScopeFromValue, tagCounts, toneAdjustmentsActive, toneLabel, update, } from "./ui-state.js";
import { isSome, none, optionValueOr, some } from "./option.js";
import { h, mount, patch } from "./vdom.js";
import { viewStudyPrintBody } from "./xml-body-view.js";
const MAX_PROCESSED_PIXELS = 7_000_000;
const HISTOGRAM_BINS = 256;
const AUTO_LOW_PERCENTILE = 0.01;
const AUTO_HIGH_PERCENTILE = 0.99;
const PROCESS_CHUNK_BYTES = 220_000 * 4;
const DEFAULT_LIGHTNESS_RANGE = { low: 0, high: 1 };
const WEBGL_VERTEX_SHADER = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`;
const WEBGL_FRAGMENT_SHADER = `
precision mediump float;

uniform sampler2D u_image;
uniform float u_inverted;
uniform float u_autoNormalize;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_rangeLow;
uniform float u_rangeHigh;

varying vec2 v_texCoord;

float srgbToLinear(float value) {
  if (value <= 0.04045) {
    return value / 12.92;
  }
  return pow((value + 0.055) / 1.055, 2.4);
}

float linearToSrgb(float value) {
  if (value <= 0.0031308) {
    return value * 12.92;
  }
  return 1.055 * pow(value, 1.0 / 2.4) - 0.055;
}

vec3 srgbToLinearRgb(vec3 color) {
  return vec3(
    srgbToLinear(color.r),
    srgbToLinear(color.g),
    srgbToLinear(color.b)
  );
}

vec3 linearToSrgbRgb(vec3 color) {
  return vec3(
    linearToSrgb(color.r),
    linearToSrgb(color.g),
    linearToSrgb(color.b)
  );
}

vec3 linearSrgbToOklab(vec3 color) {
  float l = pow(max(0.4122214708 * color.r + 0.5363325363 * color.g + 0.0514459929 * color.b, 0.0), 1.0 / 3.0);
  float m = pow(max(0.2119034982 * color.r + 0.6806995451 * color.g + 0.1073969566 * color.b, 0.0), 1.0 / 3.0);
  float s = pow(max(0.0883024619 * color.r + 0.2817188376 * color.g + 0.6299787005 * color.b, 0.0), 1.0 / 3.0);
  return vec3(
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
  );
}

vec3 oklabToLinearSrgb(float l, float a, float b) {
  float lPrime = l + 0.3963377774 * a + 0.2158037573 * b;
  float mPrime = l - 0.1055613458 * a - 0.0638541728 * b;
  float sPrime = l - 0.0894841775 * a - 1.2914855480 * b;
  float l3 = lPrime * lPrime * lPrime;
  float m3 = mPrime * mPrime * mPrime;
  float s3 = sPrime * sPrime * sPrime;
  return vec3(
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3
  );
}

bool inGamut(vec3 color) {
  return color.r >= 0.0 &&
    color.r <= 1.0 &&
    color.g >= 0.0 &&
    color.g <= 1.0 &&
    color.b >= 0.0 &&
    color.b <= 1.0;
}

vec3 oklabToDisplaySrgb(float lightness, float a, float b) {
  float chroma = 1.0;
  vec3 linearRgb = vec3(0.0, 0.0, 0.0);
  for (int i = 0; i < 10; i += 1) {
    linearRgb = oklabToLinearSrgb(lightness, a * chroma, b * chroma);
    if (inGamut(linearRgb)) {
      break;
    }
    chroma *= 0.82;
  }
  return clamp(linearToSrgbRgb(clamp(linearRgb, 0.0, 1.0)), 0.0, 1.0);
}

void main() {
  vec4 texel = texture2D(u_image, v_texCoord);
  vec3 lab = linearSrgbToOklab(srgbToLinearRgb(texel.rgb));
  float lightness = lab.x;
  if (u_inverted > 0.5) {
    lightness = 1.0 - lightness;
  }
  if (u_autoNormalize > 0.5 && u_rangeHigh - u_rangeLow > 0.025) {
    lightness = (lightness - u_rangeLow) / (u_rangeHigh - u_rangeLow);
  }
  float adjusted = clamp((lightness - 0.5) * u_contrast + 0.5 + u_brightness, 0.0, 1.0);
  gl_FragColor = vec4(oklabToDisplaySrgb(adjusted, lab.y, lab.z), texel.a);
}
`;
let model;
let tree = none();
let webGlToneRenderer = none();
const THEME_VARS = {
    [THEMES.LIGHT]: {
        "--bg": "#f6f7f8",
        "--panel": "#ffffff",
        "--panel-subtle": "#fafbfc",
        "--ink": "#171b20",
        "--muted": "#5e6873",
        "--line": "#d8dee6",
        "--line-strong": "#b9c3cf",
        "--accent": "#0b6f6b",
        "--accent-soft": "#e4f3f1",
        "--viewer-bg": "#eef1f4",
        "--button-bg": "#ffffff",
        "--button-ink": "#171b20",
        colorScheme: "light",
    },
    [THEMES.DARK]: {
        "--bg": "#10110f",
        "--panel": "#181916",
        "--panel-subtle": "#141512",
        "--ink": "#f2f0e8",
        "--muted": "#aaa79e",
        "--line": "#33342e",
        "--line-strong": "#55584d",
        "--accent": "#48c4ba",
        "--accent-soft": "#173a36",
        "--viewer-bg": "#050505",
        "--button-bg": "#22231f",
        "--button-ink": "#f2f0e8",
        colorScheme: "dark",
    },
};
const root = qs("#app");
const [initialModel, initialCmds] = initModel();
model = initialModel;
renderApp();
runCmds(initialCmds);
document.addEventListener("fullscreenchange", () => {
    dispatch({
        type: "FullscreenChanged",
        target: activeFullscreenTarget(),
    });
});
window.addEventListener("resize", () => {
    dispatch({ type: "LayoutMeasured", metrics: readLayoutMetrics() });
});
function dispatch(msg) {
    const [nextModel, cmds] = update(model, msg);
    model = nextModel;
    renderApp();
    runCmds(cmds);
}
function renderApp() {
    const nextTree = view(model, dispatch);
    tree = isSome(tree) ? some(patch(root, tree.value, nextTree)) : some(mount(root, nextTree));
}
function runCmds(cmds) {
    for (const cmd of cmds) {
        runCmd(cmd);
    }
}
function runCmd(cmd) {
    switch (cmd.type) {
        case "LoadContents":
            void loadContents();
            return;
        case "MeasureLayout":
            requestAnimationFrame(() => {
                dispatch({ type: "LayoutMeasured", metrics: readLayoutMetrics() });
            });
            return;
        case "SyncImageProcessing":
            void processImage(cmd.token);
            return;
        case "ToggleFullscreen":
            void toggleFullscreen(cmd.target);
            return;
    }
    assertNever(cmd);
}
async function loadContents() {
    try {
        const response = await fetch("/api/contents");
        if (!response.ok) {
            throw new Error(`failed to load contents: ${response.status}`);
        }
        dispatch({ type: "ContentsLoaded", items: (await response.json()) });
    }
    catch (error) {
        dispatch({
            type: "ContentsFailed",
            message: error instanceof Error ? error.message : String(error),
        });
    }
}
function view(current, send) {
    return h("div", { class: "shell", style: shellStyle(current) }, viewTopbar(current, send), h("main", {
        id: "workspace",
        class: "workspace",
        style: workspaceStyle(current),
    }, viewFilters(current, send), resizeHandle("filterResize", "Resize filters", "vertical", (event) => beginResize(event, "filters")), viewResults(current, send), resizeHandle("resultsResize", "Resize results", "vertical", (event) => beginResize(event, "results")), viewDetail(current, send)));
}
function viewTopbar(current, send) {
    const metrics = metricValues(current);
    return h("header", { class: "topbar" }, h("div", { class: "brand-block" }, h("h1", {}, "StudyPrint Viewer"), h("p", { id: "statusLine" }, current.status)), h("div", { class: "topbar-right" }, h("div", { class: "metrics", "aria-label": "summary" }, metricCard("metricContents", metrics.contents, "contents"), metricCard("metricFields", metrics.fields, "fields"), metricCard("metricFormulas", metrics.formulas, "formulas")), toolButton(themeLabel(current), {
        ...toolButtonBase(),
        id: some("themeToggle"),
        wide: true,
        active: current.theme === THEMES.DARK,
        title: some("Toggle theme"),
        onClick: some(() => send({ type: "ToggleTheme" })),
    })));
}
function metricCard(id, value, label) {
    return h("div", {}, h("span", { id }, String(value)), h("small", {}, label));
}
function viewFilters(current, send) {
    const fields = fieldCounts(current);
    const dates = dateCounts(current);
    const tags = tagCounts(current);
    return h("aside", { id: "filtersPanel", class: "filters", "aria-label": "filters" }, h("div", { class: "filter-section-title" }, "Browse"), selectFilter("fieldSelect", "Field", "All fields", current.field, fields, fieldOptionLabel(fields), (value) => send({ type: "FieldChanged", value: selectValueOption(value) })), selectFilter("dateSelect", "Date", "All dates", current.date, dates, plainOptionLabel, (value) => send({ type: "DateChanged", value: selectValueOption(value) })), h("div", { class: "filter-block" }, h("span", {}, "Tags"), h("div", { id: "tagList", class: "tag-list" }, ...[...tags.entries()]
        .sort(compareTagCounts)
        .map(([tag, count]) => h("button", {
        key: tag,
        type: "button",
        class: "tag-button",
        style: tagButtonStyle(optionStringEquals(current.tag, tag)),
        onClick: () => send({ type: "TagToggled", tag }),
    }, `${tag} ${count}`)))), h("div", { class: "filter-section-title" }, "Advanced"), viewAdvancedSearch(current, send));
}
function viewAdvancedSearch(current, send) {
    const issue = advancedSearchIssue(current);
    return h("div", { class: "advanced-search" }, h("label", { class: "filter-block" }, h("span", {}, "Query"), h("input", {
        id: "advancedSearchInput",
        type: "search",
        autocomplete: "off",
        value: current.advancedSearch.query,
        onInput: (event) => send({
            type: "AdvancedSearchQueryChanged",
            value: event.currentTarget.value,
        }),
    })), h("div", { class: "filter-block" }, h("span", {}, "Mode"), h("div", { class: "segmented" }, searchModeButton("Text", SEARCH_MODES.PLAIN, current.advancedSearch.mode, send), searchModeButton("Regex", SEARCH_MODES.REGEX, current.advancedSearch.mode, send), searchModeButton("Fuzzy", SEARCH_MODES.FUZZY, current.advancedSearch.mode, send))), h("label", { class: "filter-block" }, h("span", {}, "Target"), h("select", {
        id: "advancedSearchScope",
        value: current.advancedSearch.scope,
        onChange: (event) => {
            const scope = searchScopeFromValue(event.currentTarget.value);
            if (isSome(scope))
                send({ type: "AdvancedSearchScopeChanged", scope: scope.value });
        },
    }, searchScopeOption("All", SEARCH_SCOPES.ALL), searchScopeOption("Title", SEARCH_SCOPES.TITLE), searchScopeOption("Body", SEARCH_SCOPES.BODY), searchScopeOption("Meta", SEARCH_SCOPES.META), searchScopeOption("Tags", SEARCH_SCOPES.TAGS), searchScopeOption("Field", SEARCH_SCOPES.FIELD), searchScopeOption("Date", SEARCH_SCOPES.DATE), searchScopeOption("Filename", SEARCH_SCOPES.FILENAME))), h("label", { class: "filter-block" }, h("span", {}, "Case"), h("select", {
        id: "advancedSearchCase",
        value: current.advancedSearch.caseSensitive ? "sensitive" : "insensitive",
        onChange: (event) => send({
            type: "AdvancedSearchCaseSensitivityChanged",
            caseSensitive: event.currentTarget.value === "sensitive",
        }),
    }, h("option", { value: "insensitive" }, "Ignore case"), h("option", { value: "sensitive" }, "Match case"))), toolButton("Reset search", {
        ...toolButtonBase(),
        id: some("advancedSearchReset"),
        wide: true,
        title: some("Clear advanced search"),
        onClick: some(() => send({ type: "ResetAdvancedSearch" })),
    }), isSome(issue) ? h("div", { class: "filter-error" }, searchIssueText(issue.value)) : h("div", { class: "filter-hint" }, ""));
}
function searchModeButton(label, mode, current, send) {
    return h("button", {
        type: "button",
        class: current === mode ? "segmented-button segmented-button-active" : "segmented-button",
        onClick: () => send({ type: "AdvancedSearchModeChanged", mode }),
    }, label);
}
function searchScopeOption(label, scope) {
    return h("option", { value: scope }, label);
}
function selectFilter(id, label, allLabel, value, counts, optionLabel, onChange) {
    return h("label", { class: "filter-block" }, h("span", {}, label), h("select", {
        id,
        value: optionValueOr(value, ""),
        onChange: (event) => onChange(event.currentTarget.value),
    }, h("option", { value: "" }, allLabel), ...[...counts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], "ja"))
        .map(([optionValue, count]) => h("option", { key: optionValue, value: optionValue }, `${optionLabel(optionValue)} (${count})`))));
}
function plainOptionLabel(value) {
    return value;
}
function fieldOptionLabel(fields) {
    return (value) => {
        const childPrefix = `${value}/`;
        for (const candidate of fields.keys()) {
            if (candidate.startsWith(childPrefix))
                return childPrefix;
        }
        return value;
    };
}
function compareTagCounts(a, b) {
    const countOrder = b[1] - a[1];
    if (countOrder !== 0)
        return countOrder;
    return a[0].localeCompare(b[0], "ja");
}
function selectValueOption(value) {
    if (value.length === 0)
        return none();
    return some(value);
}
function optionStringEquals(value, expected) {
    return isSome(value) && value.value === expected;
}
function viewResults(current, send) {
    const items = filteredItems(current);
    return h("section", { id: "resultsPanel", class: "results", "aria-label": "contents" }, h("div", { class: "results-head" }, h("strong", { id: "resultCount" }, String(items.length)), h("span", {}, " matches")), h("div", { id: "contentList", class: "content-list" }, items.length === 0
        ? h("div", { class: "empty" }, "No matching pages.")
        : items.map((item) => viewResultRow(current, item, send))));
}
function resultRowSelected(current, item) {
    return isSome(current.selectedId) && item.global_content_id === current.selectedId.value;
}
function viewResultRow(current, item, send) {
    return h("button", {
        key: item.global_content_id,
        type: "button",
        class: "content-row",
        style: resultRowStyle(resultRowSelected(current, item)),
        onClick: () => send({ type: "SelectItem", id: some(item.global_content_id) }),
    }, h("div", { class: "row-title" }, item.title), h("div", { class: "row-meta" }, `${item.logical_date} / ${item.primary_field_path}`), h("div", { class: "row-text" }, item.text.slice(0, 160)));
}
function viewDetail(current, send) {
    const item = selectedItem(current);
    return h("section", {
        id: "detailPanel",
        class: "detail",
        "aria-label": "detail",
        style: detailStyle(current),
    }, h("header", { class: "detail-head" }, h("div", { class: "detail-title-block" }, h("h2", { id: "detailTitle" }, isSome(item) ? item.value.title : "Select a page"), h("p", { id: "detailMeta" }, isSome(item)
        ? `${item.value.print_id} / ${item.value.logical_date} / ${item.value.primary_field_path}`
        : "")), viewDetailTools(current, send)), viewPreview(current, item, send), resizeHandle("previewResize", "Resize preview", "horizontal", (event) => beginResize(event, "preview")), viewDetailInfo(current, item, send));
}
function viewDetailInfo(current, item, send) {
    return h("section", { id: "detailInfo", class: "detail-info", "aria-label": "body and xml" }, viewDetailTabs(current, send), viewDetailTabPanel(current, item, send));
}
function viewDetailTabs(current, send) {
    const bodyFullscreen = fullscreenActive(current, FULLSCREEN_TARGETS.BODY);
    return h("div", { class: "detail-tabbar" }, h("div", { class: "detail-tablist", role: "tablist", "aria-label": "detail data" }, detailTabButton("Body", DETAIL_TABS.BODY, current.detailTab, send), detailTabButton("XML Tree", DETAIL_TABS.XML_TREE, current.detailTab, send), detailTabButton("XML Raw", DETAIL_TABS.XML_RAW, current.detailTab, send)), toolButton(bodyFullscreen ? "Exit" : "Full", {
        ...toolButtonBase(),
        id: some("bodyFullscreenButton"),
        title: some("Toggle body fullscreen"),
        wide: true,
        active: bodyFullscreen,
        onClick: some(() => send({ type: "RequestFullscreenToggle", target: FULLSCREEN_TARGETS.BODY })),
    }));
}
function detailTabButton(label, tab, activeTab, send) {
    const active = tab === activeTab;
    return h("button", {
        type: "button",
        class: "detail-tab",
        role: "tab",
        "aria-selected": active ? "true" : "false",
        style: detailTabStyle(active),
        onClick: () => send({ type: "SetDetailTab", tab }),
    }, label);
}
function viewDetailTabPanel(current, item, send) {
    if (!isSome(item)) {
        return h("div", { class: "detail-tab-panel" }, h("p", { class: "empty-detail" }, "No page selected"));
    }
    if (current.detailTab === DETAIL_TABS.XML_TREE) {
        return h("div", { class: "detail-tab-panel" }, viewXmlTree(item.value.xml_text, current.collapsedXmlPaths, send));
    }
    if (current.detailTab === DETAIL_TABS.XML_RAW) {
        return h("div", { class: "detail-tab-panel detail-raw-panel" }, h("a", { class: "xml-open-link", href: item.value.xml_url, target: "_blank", rel: "noreferrer" }, "Open XML"), h("pre", { id: "xmlRawText", class: "xml-raw-text" }, item.value.xml_text));
    }
    return h("div", { class: "detail-tab-panel" }, h("div", { class: "detail-body-view" }, h("div", { id: "detailTags", class: "detail-tags" }, ...item.value.tags.map((tag) => h("span", { key: tag, class: "tag", style: tagButtonStyle(false) }, tag))), viewStudyPrintBody(item.value.xml_text, item.value.global_content_id)));
}
function viewXmlTree(xmlText, collapsedPaths, send) {
    const documentOption = parseXmlDocument(xmlText);
    if (!isSome(documentOption)) {
        return h("pre", { class: "xml-raw-text xml-error" }, xmlText);
    }
    const rootElement = nullableOption(documentOption.value.documentElement);
    if (!isSome(rootElement)) {
        return h("pre", { class: "xml-raw-text xml-error" }, xmlText);
    }
    return h("div", { id: "xmlTree", class: "xml-tree" }, viewXmlElement(rootElement.value, "0", collapsedPaths, send));
}
function parseXmlDocument(xmlText) {
    const document = new DOMParser().parseFromString(xmlText, "application/xml");
    if (document.getElementsByTagName("parsererror").length > 0) {
        return none();
    }
    return some(document);
}
function viewXmlNode(node, path, collapsedPaths, send) {
    if (node.nodeType === Node.ELEMENT_NODE) {
        return viewXmlElement(node, path, collapsedPaths, send);
    }
    if (node.nodeType === Node.COMMENT_NODE) {
        return viewXmlText(path, ["<!--", nodeText(node).trim(), "-->"], "xml-comment");
    }
    if (node.nodeType === Node.CDATA_SECTION_NODE) {
        return viewXmlText(path, ["<![CDATA[", nodeText(node), "]]>"], "");
    }
    if (node.nodeType === Node.PROCESSING_INSTRUCTION_NODE) {
        return viewXmlText(path, ["<?", node.nodeName, " ", nodeText(node), "?>"], "");
    }
    return viewXmlText(path, [nodeText(node).trim()], "");
}
function viewXmlText(path, text, extraClass) {
    return h("div", { key: path, class: extraClass.length > 0 ? `xml-text ${extraClass}` : "xml-text" }, h("span", { class: "xml-toggle-spacer" }, ""), h("span", { class: "xml-text-content" }, text));
}
function viewXmlElement(element, path, collapsedPaths, send) {
    const children = xmlDisplayChildren(element);
    const hasChildren = children.length > 0;
    const collapsed = collapsedPaths.includes(path);
    const rows = [
        h("div", { class: "xml-line" }, hasChildren
            ? h("button", {
                type: "button",
                class: "xml-toggle",
                title: collapsed ? "Expand XML node" : "Collapse XML node",
                onClick: () => send({ type: "ToggleXmlNode", path }),
            }, collapsed ? "+" : "-")
            : h("span", { class: "xml-toggle-spacer" }, ""), h("span", { class: "xml-punct" }, "<"), h("span", { class: "xml-name" }, element.nodeName), viewXmlAttributes(element), h("span", { class: "xml-punct" }, hasChildren ? ">" : "/>")),
    ];
    if (hasChildren && collapsed) {
        rows.push(h("div", { class: "xml-collapsed" }, h("span", { class: "xml-ellipsis" }, "..."), h("span", { class: "xml-punct" }, "</"), h("span", { class: "xml-name" }, element.nodeName), h("span", { class: "xml-punct" }, ">")));
    }
    if (hasChildren && !collapsed) {
        rows.push(h("div", { class: "xml-children" }, children.map((child, index) => viewXmlNode(child, `${path}/${String(index)}`, collapsedPaths, send)), h("div", { class: "xml-line" }, h("span", { class: "xml-toggle-spacer" }, ""), h("span", { class: "xml-punct" }, "</"), h("span", { class: "xml-name" }, element.nodeName), h("span", { class: "xml-punct" }, ">"))));
    }
    return h("div", { key: path, class: "xml-node" }, rows);
}
function viewXmlAttributes(element) {
    const nodes = [];
    for (let index = 0; index < element.attributes.length; index += 1) {
        const attribute = nullableOption(element.attributes.item(index));
        if (isSome(attribute)) {
            nodes.push(h("span", { key: `${attribute.value.name}-${String(index)}`, class: "xml-attr" }, h("span", { class: "xml-attr-name" }, attribute.value.name), h("span", { class: "xml-punct" }, "=\""), h("span", { class: "xml-attr-value" }, attribute.value.value), h("span", { class: "xml-punct" }, "\"")));
        }
    }
    return nodes;
}
function xmlDisplayChildren(element) {
    const nodes = [];
    for (let index = 0; index < element.childNodes.length; index += 1) {
        const child = nullableOption(element.childNodes.item(index));
        if (isSome(child) && xmlNodeHasDisplayContent(child.value)) {
            nodes.push(child.value);
        }
    }
    return nodes;
}
function xmlNodeHasDisplayContent(node) {
    if (node.nodeType === Node.TEXT_NODE) {
        return nodeText(node).trim().length > 0;
    }
    if (node.nodeType === Node.COMMENT_NODE) {
        return nodeText(node).trim().length > 0;
    }
    return true;
}
function nodeText(node) {
    return optionValueOr(nullableOption(node.nodeValue), "");
}
function viewDetailTools(current, send) {
    const previewFullscreen = fullscreenActive(current, FULLSCREEN_TARGETS.PREVIEW);
    return h("div", { class: "detail-tools", "aria-label": "image tools" }, h("div", { class: "tool-row" }, toolButton("L", {
        ...toolButtonBase(),
        title: some("Rotate left"),
        onClick: some(() => send({ type: "RotateBy", degrees: -90 })),
    }), toolButton("R", {
        ...toolButtonBase(),
        title: some("Rotate right"),
        onClick: some(() => send({ type: "RotateBy", degrees: 90 })),
    }), toolButton("-", {
        ...toolButtonBase(),
        title: some("Zoom out"),
        disabled: current.zoom <= MIN_ZOOM,
        onClick: some(() => send({ type: "ZoomBy", delta: -ZOOM_STEP })),
    }), toolButton("+", {
        ...toolButtonBase(),
        title: some("Zoom in"),
        disabled: current.zoom >= MAX_ZOOM,
        onClick: some(() => send({ type: "ZoomBy", delta: ZOOM_STEP })),
    }), toolButton("Reset", {
        ...toolButtonBase(),
        id: some("resetView"),
        wide: true,
        onClick: some(() => send({ type: "ResetView" })),
    }), toolButton(toneLabel(current), {
        ...toolButtonBase(),
        id: some("toneModeToggle"),
        wide: true,
        active: toneOptions(current.tone, current.theme).inverted,
        onClick: some(() => send({ type: "CycleTone" })),
    }), toolButton(previewFullscreen ? "Exit" : "Full", {
        ...toolButtonBase(),
        id: some("fullscreenButton"),
        wide: true,
        active: previewFullscreen,
        onClick: some(() => send({ type: "RequestFullscreenToggle", target: FULLSCREEN_TARGETS.PREVIEW })),
    }), viewOpenImageLink(current)), h("div", { class: "tool-row" }, fitButton("Width", FIT_MODES.WIDTH, current, send), fitButton("Height", FIT_MODES.HEIGHT, current, send), fitButton("Page", FIT_MODES.BOTH, current, send), toolButton("Norm", {
        ...toolButtonBase(),
        id: some("normalizeToggle"),
        wide: true,
        active: current.tone.autoNormalize,
        onClick: some(() => send({ type: "ToggleNormalize" })),
    }), toolButton("Tone 0", {
        ...toolButtonBase(),
        id: some("resetToneAdjust"),
        wide: true,
        active: toneAdjustmentsActive(current),
        onClick: some(() => send({ type: "ResetToneAdjustments" })),
    })), viewAdjustRow(current, send, false));
}
function viewOpenImageLink(current) {
    const item = selectedItem(current);
    if (isSome(item)) {
        return h("a", {
            id: "openImage",
            class: "image-link",
            href: item.value.image_url,
            target: "_blank",
            rel: "noreferrer",
        }, "Open");
    }
    return toolButton("Open", {
        ...toolButtonBase(),
        id: some("openImage"),
        wide: true,
        disabled: true,
    });
}
function viewPreview(current, item, send) {
    const imageLayout = currentImageLayout(current);
    const canvasRequired = needsCanvasProcessing(current);
    const imageLoaded = isSome(current.image.naturalSize);
    const canvasVisible = canvasRequired && imageLoaded;
    const mediaBase = mediaStyle(imageLayout);
    return h("section", {
        id: "previewPane",
        class: "preview",
        style: previewStyle(current, imageLayout),
        "aria-label": "image preview",
    }, h("div", {
        id: "imageStage",
        class: "image-stage",
        style: imageStageStyle(current, imageLayout),
    }, h("img", {
        id: "detailImage",
        alt: isSome(item) ? item.value.title : "",
        ...imageSourceProp(item),
        style: sourceMediaStyle(mediaBase, canvasVisible),
        onLoad: (event) => {
            const image = event.currentTarget;
            send({
                type: "ImageLoaded",
                size: { width: image.naturalWidth, height: image.naturalHeight },
            });
        },
    }), h("canvas", {
        id: "darkImageCanvas",
        "aria-hidden": "true",
        style: canvasMediaStyle(mediaBase, canvasVisible),
    })), fullscreenToolsNodes(current, send));
}
function fullscreenToolsNodes(current, send) {
    if (!fullscreenActive(current, FULLSCREEN_TARGETS.PREVIEW))
        return [];
    return [viewFullscreenTools(current, send)];
}
function viewFullscreenTools(current, send) {
    const panelOpen = fullscreenPanelOpen(current);
    return h("div", {
        id: "fullscreenTools",
        class: "fullscreen-tools",
        style: fullscreenToolsStyle(),
        onPointerEnter: () => send({ type: "FullscreenToolsPointerEntered" }),
        onPointerLeave: () => send({ type: "FullscreenToolsPointerLeft" }),
    }, h("button", {
        id: "fullscreenToolbarTab",
        class: "fullscreen-tab",
        style: fullscreenTabStyle(panelOpen),
        type: "button",
        title: "Show or hide fullscreen tools",
        onClick: () => send({ type: "ToggleFullscreenTools" }),
    }, "Tools"), h("div", {
        class: "fullscreen-panel",
        "aria-label": "fullscreen tools",
        style: fullscreenPanelStyle(panelOpen),
    }, h("div", { class: "fullscreen-panel-head" }, h("span", {}, "Tools"), toolButton("Pin", {
        ...toolButtonBase(),
        id: some("fullscreenPin"),
        wide: true,
        active: current.fullscreenTools === FULLSCREEN_TOOLS.PINNED,
        onClick: some(() => send({ type: "ToggleFullscreenToolsPin" })),
    }), toolButton("Hide", {
        ...toolButtonBase(),
        wide: true,
        onClick: some(() => send({ type: "HideFullscreenTools" })),
    })), h("div", { class: "tool-row" }, toolButton("L", {
        ...toolButtonBase(),
        onClick: some(() => send({ type: "RotateBy", degrees: -90 })),
    }), toolButton("R", {
        ...toolButtonBase(),
        onClick: some(() => send({ type: "RotateBy", degrees: 90 })),
    }), toolButton("-", {
        ...toolButtonBase(),
        onClick: some(() => send({ type: "ZoomBy", delta: -ZOOM_STEP })),
    }), toolButton("+", {
        ...toolButtonBase(),
        onClick: some(() => send({ type: "ZoomBy", delta: ZOOM_STEP })),
    }), toolButton("Reset", {
        ...toolButtonBase(),
        wide: true,
        onClick: some(() => send({ type: "ResetView" })),
    })), h("div", { class: "tool-row" }, fitButton("Width", FIT_MODES.WIDTH, current, send), fitButton("Height", FIT_MODES.HEIGHT, current, send), fitButton("Page", FIT_MODES.BOTH, current, send)), h("div", { class: "tool-row" }, toolButton(themeLabel(current), {
        ...toolButtonBase(),
        wide: true,
        active: current.theme === THEMES.DARK,
        onClick: some(() => send({ type: "ToggleTheme" })),
    }), toolButton(toneLabel(current), {
        ...toolButtonBase(),
        wide: true,
        active: toneOptions(current.tone, current.theme).inverted,
        onClick: some(() => send({ type: "CycleTone" })),
    }), toolButton("Norm", {
        ...toolButtonBase(),
        wide: true,
        active: current.tone.autoNormalize,
        onClick: some(() => send({ type: "ToggleNormalize" })),
    }), toolButton("Exit", {
        ...toolButtonBase(),
        wide: true,
        active: fullscreenActive(current, FULLSCREEN_TARGETS.PREVIEW),
        onClick: some(() => send({ type: "RequestFullscreenToggle", target: FULLSCREEN_TARGETS.PREVIEW })),
    })), viewAdjustRow(current, send, true)));
}
function viewAdjustRow(current, send, fullscreen) {
    const resetTools = fullscreen
        ? [
            toolButton("Tone 0", {
                ...toolButtonBase(),
                wide: true,
                active: toneAdjustmentsActive(current),
                onClick: some(() => send({ type: "ResetToneAdjustments" })),
            }),
        ]
        : [];
    return h("div", { class: fullscreen ? "adjust-row fullscreen-adjust" : "adjust-row" }, rangeControl(fullscreen ? "fsBrightnessRange" : "brightnessRange", "Light", current.tone.brightness, TONE_BRIGHTNESS_MIN, TONE_BRIGHTNESS_MAX, (value) => send({ type: "BrightnessChanged", value })), rangeControl(fullscreen ? "fsContrastRange" : "contrastRange", "Contrast", current.tone.contrast, TONE_CONTRAST_MIN, TONE_CONTRAST_MAX, (value) => send({ type: "ContrastChanged", value })), resetTools);
}
function rangeControl(id, label, value, min, max, onInput) {
    return h("label", { class: "range-control" }, h("span", {}, label), h("input", {
        id,
        type: "range",
        min: String(min),
        max: String(max),
        value: String(value),
        onInput: (event) => onInput(Number(event.currentTarget.value)),
    }));
}
function fitButton(label, mode, current, send) {
    return toolButton(label, {
        ...toolButtonBase(),
        wide: true,
        active: current.fitMode === mode,
        onClick: some(() => send({ type: "SetFitMode", mode })),
    });
}
function toolButton(label, options) {
    const props = {
        class: options.wide ? "tool-button wide" : "tool-button",
        style: toolButtonStyle(options.active, options.disabled),
        type: "button",
    };
    if (isSome(options.id))
        props.id = options.id.value;
    if (isSome(options.title))
        props.title = options.title.value;
    if (options.disabled)
        props.disabled = true;
    if (isSome(options.onClick))
        props.onClick = options.onClick.value;
    return h("button", props, label);
}
function toolButtonBase() {
    return {
        id: none(),
        wide: false,
        active: false,
        disabled: false,
        title: none(),
        onClick: none(),
    };
}
function resizeHandle(id, label, orientation, onPointerDown) {
    return h("div", {
        id,
        class: `resize-handle resize-handle-${orientation}`,
        role: "separator",
        "aria-label": label,
        "aria-orientation": orientation,
        tabindex: "0",
        onPointerDown,
        onKeyDown: (event) => resizeWithKeyboard(event, orientation, id),
    });
}
function resizeWithKeyboard(event, orientation, id) {
    const negativeKey = orientation === "horizontal" ? "ArrowUp" : "ArrowLeft";
    const positiveKey = orientation === "horizontal" ? "ArrowDown" : "ArrowRight";
    if (event.key !== negativeKey && event.key !== positiveKey)
        return;
    event.preventDefault();
    const delta = event.key === positiveKey ? 24 : -24;
    const target = id === "filterResize" ? "filters" : id === "resultsResize" ? "results" : "preview";
    const currentValue = target === "filters"
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
function currentImageLayout(current) {
    const source = activeSourceSize(current);
    const viewport = current.layout.previewViewport;
    if (!isSome(source) || !isSome(viewport))
        return none();
    return some(mediaLayout(source.value, viewport.value, {
        fitMode: current.fitMode,
        rotation: current.rotation,
        zoom: current.zoom,
    }));
}
function workspaceStyle(current) {
    const style = {};
    if (isSome(current.layout.filtersWidth))
        style["--filters-width"] = `${current.layout.filtersWidth.value}px`;
    if (isSome(current.layout.resultsWidth))
        style["--results-width"] = `${current.layout.resultsWidth.value}px`;
    return style;
}
function detailStyle(current) {
    return isSome(current.layout.previewHeight)
        ? { "--preview-height": `${current.layout.previewHeight.value}px` }
        : {};
}
function imageStageStyle(current, layout) {
    return {
        "--rotation": `${current.rotation}deg`,
        width: isSome(layout) ? `${layout.value.stageWidth}px` : "1px",
        height: isSome(layout) ? `${layout.value.stageHeight}px` : "1px",
    };
}
function mediaStyle(layout) {
    return isSome(layout)
        ? { width: `${layout.value.mediaWidth}px`, height: `${layout.value.mediaHeight}px` }
        : { width: "1px", height: "1px" };
}
function shellStyle(current) {
    return {
        ...THEME_VARS[current.theme],
        background: "var(--bg)",
        color: "var(--ink)",
    };
}
function tagButtonStyle(active) {
    return active
        ? {
            borderColor: "var(--accent)",
            background: "var(--accent-soft)",
            color: "var(--accent)",
        }
        : {};
}
function detailTabStyle(active) {
    return active
        ? {
            borderColor: "var(--accent)",
            background: "var(--accent-soft)",
            color: "var(--accent)",
        }
        : {};
}
function resultRowStyle(selected) {
    return selected ? { background: "var(--accent-soft)" } : {};
}
function toolButtonStyle(active, disabled) {
    const style = {};
    if (active) {
        style.borderColor = "var(--accent)";
        style.background = "var(--accent-soft)";
        style.color = "var(--accent)";
    }
    if (disabled) {
        style.opacity = "0.55";
        style.cursor = "default";
    }
    return style;
}
function previewStyle(current, layout) {
    const style = {};
    if (isSome(layout)) {
        style.justifyContent = layout.value.overflowX ? "flex-start" : "center";
        style.alignItems = layout.value.overflowY ? "flex-start" : "center";
    }
    if (fullscreenActive(current, FULLSCREEN_TARGETS.PREVIEW)) {
        style.width = "100vw";
        style.height = "100vh";
        style.border = "0";
        style.borderRadius = "0";
        style.padding = "20px";
        style.background = "var(--viewer-bg)";
    }
    return style;
}
function sourceMediaStyle(base, processedVisible) {
    return {
        ...base,
        display: processedVisible ? "none" : "block",
    };
}
function canvasMediaStyle(base, processedVisible) {
    return {
        ...base,
        display: processedVisible ? "block" : "none",
    };
}
function fullscreenPanelOpen(current) {
    return (current.fullscreenTools === FULLSCREEN_TOOLS.HOVER_OPEN ||
        current.fullscreenTools === FULLSCREEN_TOOLS.PINNED);
}
function fullscreenToolsStyle() {
    return {
        display: "block",
        position: "fixed",
        top: "16px",
        right: "16px",
        zIndex: "20",
    };
}
function fullscreenTabStyle(open) {
    return open
        ? {
            borderColor: "var(--accent)",
            background: "var(--accent-soft)",
            color: "var(--accent)",
        }
        : {};
}
function fullscreenPanelStyle(open) {
    return open
        ? {
            opacity: "1",
            pointerEvents: "auto",
            transform: "translateX(0)",
        }
        : {
            opacity: "0",
            pointerEvents: "none",
            transform: "translateX(8px)",
        };
}
function beginResize(event, target) {
    if (event.button !== 0)
        return;
    const startX = event.clientX;
    const startY = event.clientY;
    const startFilters = currentFiltersWidth();
    const startResults = currentResultsWidth();
    const startPreview = currentPreviewHeight();
    event.preventDefault();
    const onMove = (moveEvent) => {
        const value = target === "filters"
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
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", finish);
        document.removeEventListener("pointercancel", finish);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", finish);
}
function readLayoutMetrics() {
    const preview = qs("#previewPane");
    const padding = document.fullscreenElement === preview ? 40 : 24;
    return {
        workspaceWidth: qs("#workspace").clientWidth,
        detailHeight: qs("#detailPanel").clientHeight,
        detailHeadHeight: qs(".detail-head").getBoundingClientRect().height,
        previewViewport: {
            width: Math.max(120, preview.clientWidth - padding),
            height: Math.max(120, preview.clientHeight - padding),
        },
    };
}
function currentFiltersWidth() {
    return Math.round(optionValueOr(model.layout.filtersWidth, qs("#filtersPanel").getBoundingClientRect().width));
}
function currentResultsWidth() {
    return Math.round(optionValueOr(model.layout.resultsWidth, qs("#resultsPanel").getBoundingClientRect().width));
}
function currentPreviewHeight() {
    return Math.round(optionValueOr(model.layout.previewHeight, qs("#previewPane").getBoundingClientRect().height));
}
async function processImage(token) {
    if (token !== model.image.token)
        return;
    const image = qs("#detailImage");
    const canvas = qs("#darkImageCanvas");
    if (!image.complete || !image.naturalWidth)
        return;
    if (!needsCanvasProcessing(model)) {
        clearCanvas(canvas);
        return;
    }
    const options = toneOptions(model.tone, model.theme);
    const size = scaledCanvasSize(image.naturalWidth, image.naturalHeight);
    if (!renderToneWithWebGl(image, canvas, size, options, DEFAULT_LIGHTNESS_RANGE)) {
        dispatch({ type: "ContentsFailed", message: "WebGL image rendering is unavailable." });
        return;
    }
    if (!options.autoNormalize) {
        return;
    }
    const range = await lightnessRangeForImage(image, size, token, options);
    if (token !== model.image.token || !isSome(range))
        return;
    renderToneWithWebGl(image, canvas, size, options, range.value);
}
function scaledCanvasSize(width, height) {
    const pixels = width * height;
    if (pixels <= MAX_PROCESSED_PIXELS)
        return { width, height };
    const scale = Math.sqrt(MAX_PROCESSED_PIXELS / pixels);
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    };
}
async function lightnessRangeForImage(image, size, token, options) {
    const scratch = document.createElement("canvas");
    scratch.width = size.width;
    scratch.height = size.height;
    const context = canvas2dContext(scratch);
    if (!isSome(context))
        return none();
    context.value.drawImage(image, 0, 0, size.width, size.height);
    const imageData = context.value.getImageData(0, 0, size.width, size.height);
    const histogram = await buildLightnessHistogram(imageData.data, token, options);
    if (!isSome(histogram))
        return none();
    const range = lightnessRangeFromHistogram(histogram.value, imageData.data.length / 4, AUTO_LOW_PERCENTILE, AUTO_HIGH_PERCENTILE);
    return some(range);
}
async function buildLightnessHistogram(data, token, options) {
    const histogram = new Uint32Array(HISTOGRAM_BINS);
    for (let i = 0; i < data.length; i += 4) {
        const lab = srgbToOklab(byteAt(data, i), byteAt(data, i + 1), byteAt(data, i + 2));
        const lightness = sourceLightness(lab.l, options.inverted);
        const bin = Math.min(HISTOGRAM_BINS - 1, Math.max(0, Math.round(lightness * (HISTOGRAM_BINS - 1))));
        histogram[bin] = histogramValue(histogram, bin) + 1;
        if (i > 0 && i % PROCESS_CHUNK_BYTES === 0) {
            await nextFrame();
            if (token !== model.image.token)
                return none();
        }
    }
    return some(histogram);
}
function renderToneWithWebGl(image, canvas, size, options, range) {
    const renderer = webGlToneRendererForCanvas(canvas);
    if (!isSome(renderer))
        return false;
    const sourceKey = imageTextureSourceKey(image);
    if (!optionStringEquals(renderer.value.textureSourceKey, sourceKey)) {
        if (!uploadWebGlTexture(renderer.value, image))
            return false;
        renderer.value.textureSourceKey = some(sourceKey);
    }
    resizeCanvasTo(canvas, size);
    const gl = renderer.value.gl;
    gl.viewport(0, 0, size.width, size.height);
    gl.useProgram(renderer.value.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, renderer.value.texture);
    gl.uniform1i(renderer.value.locations.image, 0);
    gl.uniform1f(renderer.value.locations.inverted, booleanFloat(options.inverted));
    gl.uniform1f(renderer.value.locations.autoNormalize, booleanFloat(options.autoNormalize));
    gl.uniform1f(renderer.value.locations.brightness, options.brightness / 100);
    gl.uniform1f(renderer.value.locations.contrast, 1 + options.contrast / 100);
    gl.uniform1f(renderer.value.locations.rangeLow, range.low);
    gl.uniform1f(renderer.value.locations.rangeHigh, range.high);
    bindWebGlAttribute(gl, renderer.value.locations.position, renderer.value.positionBuffer);
    bindWebGlAttribute(gl, renderer.value.locations.texCoord, renderer.value.texCoordBuffer);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return true;
}
function webGlToneRendererForCanvas(canvas) {
    if (isSome(webGlToneRenderer) && webGlToneRenderer.value.canvas === canvas) {
        return webGlToneRenderer;
    }
    webGlToneRenderer = createWebGlToneRenderer(canvas);
    return webGlToneRenderer;
}
function createWebGlToneRenderer(canvas) {
    const gl = nullableOption(canvas.getContext("webgl", { premultipliedAlpha: false }));
    if (!isSome(gl))
        return none();
    const vertexShader = compileWebGlShader(gl.value, gl.value.VERTEX_SHADER, WEBGL_VERTEX_SHADER);
    if (!isSome(vertexShader))
        return none();
    const fragmentShader = compileWebGlShader(gl.value, gl.value.FRAGMENT_SHADER, WEBGL_FRAGMENT_SHADER);
    if (!isSome(fragmentShader)) {
        gl.value.deleteShader(vertexShader.value);
        return none();
    }
    const program = linkWebGlProgram(gl.value, vertexShader.value, fragmentShader.value);
    gl.value.deleteShader(vertexShader.value);
    gl.value.deleteShader(fragmentShader.value);
    if (!isSome(program))
        return none();
    const texture = nullableOption(gl.value.createTexture());
    const positionBuffer = nullableOption(gl.value.createBuffer());
    const texCoordBuffer = nullableOption(gl.value.createBuffer());
    const locations = webGlLocations(gl.value, program.value);
    if (!isSome(texture) || !isSome(positionBuffer) || !isSome(texCoordBuffer) || !isSome(locations)) {
        gl.value.deleteProgram(program.value);
        return none();
    }
    configureWebGlTexture(gl.value, texture.value);
    setWebGlBuffer(gl.value, positionBuffer.value, new Float32Array([
        -1, -1,
        1, -1,
        -1, 1,
        -1, 1,
        1, -1,
        1, 1,
    ]));
    setWebGlBuffer(gl.value, texCoordBuffer.value, new Float32Array([
        0, 1,
        1, 1,
        0, 0,
        0, 0,
        1, 1,
        1, 0,
    ]));
    return some({
        canvas,
        gl: gl.value,
        program: program.value,
        texture: texture.value,
        positionBuffer: positionBuffer.value,
        texCoordBuffer: texCoordBuffer.value,
        locations: locations.value,
        textureSourceKey: none(),
    });
}
function compileWebGlShader(gl, type, source) {
    const shader = nullableOption(gl.createShader(type));
    if (!isSome(shader))
        return none();
    gl.shaderSource(shader.value, source);
    gl.compileShader(shader.value);
    if (gl.getShaderParameter(shader.value, gl.COMPILE_STATUS) !== true) {
        gl.deleteShader(shader.value);
        return none();
    }
    return shader;
}
function linkWebGlProgram(gl, vertexShader, fragmentShader) {
    const program = nullableOption(gl.createProgram());
    if (!isSome(program))
        return none();
    gl.attachShader(program.value, vertexShader);
    gl.attachShader(program.value, fragmentShader);
    gl.linkProgram(program.value);
    if (gl.getProgramParameter(program.value, gl.LINK_STATUS) !== true) {
        gl.deleteProgram(program.value);
        return none();
    }
    return program;
}
function webGlLocations(gl, program) {
    const position = webGlAttributeLocation(gl, program, "a_position");
    const texCoord = webGlAttributeLocation(gl, program, "a_texCoord");
    const image = nullableOption(gl.getUniformLocation(program, "u_image"));
    const inverted = nullableOption(gl.getUniformLocation(program, "u_inverted"));
    const autoNormalize = nullableOption(gl.getUniformLocation(program, "u_autoNormalize"));
    const brightness = nullableOption(gl.getUniformLocation(program, "u_brightness"));
    const contrast = nullableOption(gl.getUniformLocation(program, "u_contrast"));
    const rangeLow = nullableOption(gl.getUniformLocation(program, "u_rangeLow"));
    const rangeHigh = nullableOption(gl.getUniformLocation(program, "u_rangeHigh"));
    if (!isSome(position) ||
        !isSome(texCoord) ||
        !isSome(image) ||
        !isSome(inverted) ||
        !isSome(autoNormalize) ||
        !isSome(brightness) ||
        !isSome(contrast) ||
        !isSome(rangeLow) ||
        !isSome(rangeHigh)) {
        return none();
    }
    return some({
        position: position.value,
        texCoord: texCoord.value,
        image: image.value,
        inverted: inverted.value,
        autoNormalize: autoNormalize.value,
        brightness: brightness.value,
        contrast: contrast.value,
        rangeLow: rangeLow.value,
        rangeHigh: rangeHigh.value,
    });
}
function webGlAttributeLocation(gl, program, name) {
    const location = gl.getAttribLocation(program, name);
    return location < 0 ? none() : some(location);
}
function configureWebGlTexture(gl, texture) {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
}
function setWebGlBuffer(gl, buffer, data) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
}
function uploadWebGlTexture(renderer, image) {
    try {
        const gl = renderer.gl;
        gl.bindTexture(gl.TEXTURE_2D, renderer.texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        return true;
    }
    catch {
        renderer.textureSourceKey = none();
        return false;
    }
}
function bindWebGlAttribute(gl, location, buffer) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
}
function resizeCanvasTo(canvas, size) {
    if (canvas.width !== size.width)
        canvas.width = size.width;
    if (canvas.height !== size.height)
        canvas.height = size.height;
}
function clearCanvas(canvas) {
    canvas.width = 0;
    canvas.height = 0;
}
function canvas2dContext(canvas) {
    return nullableOption(canvas.getContext("2d", { willReadFrequently: true }));
}
function nullableOption(value) {
    return value === null ? none() : some(value);
}
function booleanFloat(value) {
    return value ? 1 : 0;
}
function imageTextureSourceKey(image) {
    const source = image.currentSrc.length > 0 ? image.currentSrc : image.src;
    return `${source}|${image.naturalWidth}x${image.naturalHeight}`;
}
function byteAt(data, index) {
    return data[index];
}
function histogramValue(histogram, index) {
    return histogram[index];
}
async function toggleFullscreen(target) {
    try {
        const element = fullscreenElement(target);
        if (document.fullscreenElement === element) {
            await document.exitFullscreen();
        }
        else {
            await element.requestFullscreen();
        }
    }
    catch (error) {
        dispatch({
            type: "ContentsFailed",
            message: `Fullscreen failed: ${error instanceof Error ? error.message : String(error)}`,
        });
    }
}
function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
function themeLabel(current) {
    return current.theme === THEMES.DARK ? "Light" : "Dark";
}
function activeFullscreenTarget() {
    const element = nullableOption(document.fullscreenElement);
    if (!isSome(element))
        return none();
    if (element.value === qs("#previewPane"))
        return some(FULLSCREEN_TARGETS.PREVIEW);
    if (element.value === qs("#detailInfo"))
        return some(FULLSCREEN_TARGETS.BODY);
    return none();
}
function fullscreenActive(current, target) {
    return isSome(current.fullscreen) && current.fullscreen.value === target;
}
function fullscreenElement(target) {
    if (target === FULLSCREEN_TARGETS.PREVIEW)
        return qs("#previewPane");
    return qs("#detailInfo");
}
function imageSourceProp(item) {
    return isSome(item) ? { src: item.value.image_url } : {};
}
function assertNever(value) {
    throw new Error(`Unhandled command: ${JSON.stringify(value)}`);
}
function qs(selector, context = document) {
    const element = context.querySelector(selector);
    if (!element)
        throw new Error(`missing element: ${selector}`);
    return element;
}
