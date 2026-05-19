import { isSome, none, optionValueOr, some } from "./option.js";
import { h } from "./vdom.js";
const STUDYPRINT_NS = "urn:slf:studyprint:0.5";
const BODY_DISPLAY_SKIPPED_ELEMENTS = new Set(["tex", "altText"]);
const BLOCK_FORMULA_DISPLAY = "block";
export function viewStudyPrintBody(xmlText, globalContentId) {
    const documentOption = parseXmlDocument(xmlText);
    if (!isSome(documentOption)) {
        return h("pre", { id: "detailText", class: "studyprint-body studyprint-body-error" }, xmlText);
    }
    const bodyOriginal = bodyOriginalForContent(documentOption.value, globalContentId);
    if (!isSome(bodyOriginal)) {
        return h("div", { id: "detailText", class: "studyprint-body studyprint-body-error" }, h("p", {}, "body_original is missing."));
    }
    return h("div", { id: "detailText", class: "studyprint-body" }, renderChildNodes(bodyOriginal.value, "body"));
}
function parseXmlDocument(xmlText) {
    const document = new DOMParser().parseFromString(xmlText, "application/xml");
    if (document.getElementsByTagName("parsererror").length > 0) {
        return none();
    }
    return some(document);
}
function renderNode(node, path) {
    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
        return textValue(node);
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
        return "";
    }
    const element = node;
    const localName = element.localName;
    switch (localName) {
        case "section":
            return renderSection(element, path);
        case "title":
            return h("h3", { key: path, class: "body-section-title" }, renderChildNodes(element, path));
        case "p":
            return h("p", { key: path, class: "body-p" }, renderChildNodes(element, path));
        case "t":
            return h("span", { key: path }, renderChildNodes(element, path));
        case "formula":
            return renderFormula(element, path);
        case "derivation":
            return h("div", { key: path, class: "body-derivation" }, renderChildNodes(element, path));
        case "step":
            return renderStep(element, path);
        case "figureRef":
            return renderFigureRef(element, path);
        case "note":
            return h("aside", { key: path, class: "body-note" }, renderChildNodes(element, path));
        case "del":
            return h("del", { key: path, class: "body-del" }, renderChildNodes(element, path));
        case "add":
            return h("ins", { key: path, class: "body-add" }, renderChildNodes(element, path));
        case "subst":
            return h("span", { key: path, class: "body-subst" }, renderChildNodes(element, path));
        case "gap":
            return renderGap(element, path);
        case "caption":
            return h("p", { key: path, class: "body-caption" }, renderChildNodes(element, path));
        default:
            return h("div", { key: path, class: "body-block" }, renderChildNodes(element, path));
    }
}
function renderSection(element, path) {
    return h("section", {
        key: path,
        class: "body-section",
    }, renderChildNodes(element, path));
}
function renderStep(element, path) {
    const n = attributeOption(element, "n");
    return h("div", {
        key: path,
        class: "body-step",
    }, isSome(n) ? h("span", { class: "body-step-number" }, n.value) : "", h("div", { class: "body-step-content" }, renderChildNodes(element, path)));
}
function renderFormula(element, path) {
    const texElement = firstDirectChild(element, "tex");
    const tex = isSome(texElement) ? normalizedFormulaText(texElement.value) : "";
    const altText = formulaAltText(element, tex);
    const display = optionValueOr(attributeOption(element, "display"), "inline");
    const displayMode = display === BLOCK_FORMULA_DISPLAY;
    const html = katex.renderToString(tex, {
        displayMode,
        throwOnError: false,
        strict: false,
    });
    return h(displayMode ? "div" : "span", {
        key: path,
        class: displayMode ? "body-formula body-formula-block" : "body-formula body-formula-inline",
        role: "math",
        "aria-label": altText,
        title: altText,
        innerHTML: html,
    });
}
function renderFigureRef(element, path) {
    const caption = firstDirectChild(element, "caption");
    return h("figure", { key: path, class: "body-figure-ref" }, h("figcaption", {}, isSome(caption) ? renderChildNodes(caption.value, `${path}/caption`) : "figureRef"));
}
function renderGap(element, path) {
    const reason = optionValueOr(attributeOption(element, "reason"), "unreadable");
    const extent = optionValueOr(attributeOption(element, "extent"), "");
    const unit = optionValueOr(attributeOption(element, "unit"), "");
    const suffix = [extent, unit].filter((part) => part.length > 0).join(" ");
    const label = suffix.length > 0 ? `[gap: ${reason}, ${suffix}]` : `[gap: ${reason}]`;
    return h("span", { key: path, class: "body-gap" }, label);
}
function renderChildNodes(element, path) {
    const nodes = [];
    for (let index = 0; index < element.childNodes.length; index += 1) {
        const child = nullableOption(element.childNodes.item(index));
        if (isSome(child) && shouldRenderBodyNode(child.value)) {
            nodes.push(renderNode(child.value, `${path}/${String(index)}`));
        }
    }
    return nodes;
}
function shouldRenderBodyNode(node) {
    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
        return textValue(node).trim().length > 0;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
        return false;
    }
    return !BODY_DISPLAY_SKIPPED_ELEMENTS.has(node.localName);
}
function firstElementByLocalName(document, localName) {
    const elements = elementsByLocalName(document, localName);
    return firstArrayItem(elements);
}
function bodyOriginalForContent(document, globalContentId) {
    const contentId = contentIdFromGlobal(globalContentId);
    if (isSome(contentId)) {
        const content = contentElementById(document, contentId.value);
        if (isSome(content)) {
            const body = firstDescendantByLocalName(content.value, "body_original");
            if (isSome(body))
                return body;
        }
    }
    return firstElementByLocalName(document, "body_original");
}
function contentIdFromGlobal(globalContentId) {
    const parts = globalContentId.split("#");
    if (parts.length < 2)
        return none();
    return firstArrayItem(parts.slice(parts.length - 1));
}
function contentElementById(document, contentId) {
    for (const element of elementsByLocalName(document, "content")) {
        const id = attributeOption(element, "id");
        if (isSome(id) && id.value === contentId)
            return some(element);
    }
    return none();
}
function firstDescendantByLocalName(element, localName) {
    const namespaced = element.getElementsByTagNameNS(STUDYPRINT_NS, localName);
    const firstNamespaced = nullableOption(namespaced.item(0));
    if (isSome(firstNamespaced))
        return some(firstNamespaced.value);
    const fallback = element.getElementsByTagName(localName);
    const firstFallback = nullableOption(fallback.item(0));
    return isSome(firstFallback) ? some(firstFallback.value) : none();
}
function elementsByLocalName(document, localName) {
    const elements = [];
    const namespaced = document.getElementsByTagNameNS(STUDYPRINT_NS, localName);
    for (let index = 0; index < namespaced.length; index += 1) {
        const element = nullableOption(namespaced.item(index));
        if (isSome(element))
            elements.push(element.value);
    }
    if (elements.length > 0)
        return elements;
    const fallback = document.getElementsByTagName(localName);
    for (let index = 0; index < fallback.length; index += 1) {
        const element = nullableOption(fallback.item(index));
        if (isSome(element))
            elements.push(element.value);
    }
    return elements;
}
function firstArrayItem(values) {
    for (const value of values) {
        return some(value);
    }
    return none();
}
function firstDirectChild(element, localName) {
    for (let index = 0; index < element.children.length; index += 1) {
        const child = nullableOption(element.children.item(index));
        if (isSome(child) && child.value.localName === localName) {
            return some(child.value);
        }
    }
    return none();
}
function attributeOption(element, name) {
    const value = nullableOption(element.getAttribute(name));
    return isSome(value) ? some(value.value) : none();
}
function normalizedFormulaText(element) {
    return textContent(element).replace(/\s+/g, " ").trim();
}
function formulaAltText(element, fallback) {
    const altTextElement = firstDirectChild(element, "altText");
    if (!isSome(altTextElement)) {
        return fallback;
    }
    const text = normalizedFormulaText(altTextElement.value);
    return text.length > 0 ? text : fallback;
}
function textContent(element) {
    const values = [];
    for (let index = 0; index < element.childNodes.length; index += 1) {
        const child = nullableOption(element.childNodes.item(index));
        if (isSome(child)) {
            values.push(textValue(child.value));
        }
    }
    return values.join("");
}
function textValue(node) {
    return optionValueOr(nullableOption(node.nodeValue), "");
}
function nullableOption(value) {
    return value === null ? none() : some(value);
}
