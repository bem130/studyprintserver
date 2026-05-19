import { isSome, none, optionValueOr, some, type Option } from "./option.js";
import { h, type VNode } from "./vdom.js";

const STUDYPRINT_NS = "urn:slf:studyprint:0.5";

const BODY_DISPLAY_SKIPPED_ELEMENTS = new Set(["tex", "altText"]);
const BLOCK_FORMULA_DISPLAY = "block";

export function viewStudyPrintBody(xmlText: string): VNode {
  const documentOption = parseXmlDocument(xmlText);
  if (!isSome(documentOption)) {
    return h("pre", { id: "detailText", class: "studyprint-body studyprint-body-error" }, xmlText);
  }

  const bodyOriginal = firstElementByLocalName(documentOption.value, "body_original");
  if (!isSome(bodyOriginal)) {
    return h(
      "div",
      { id: "detailText", class: "studyprint-body studyprint-body-error" },
      h("p", {}, "body_original is missing."),
    );
  }

  return h(
    "div",
    { id: "detailText", class: "studyprint-body" },
    renderChildNodes(bodyOriginal.value, "body"),
  );
}

function parseXmlDocument(xmlText: string): Option<Document> {
  const document = new DOMParser().parseFromString(xmlText, "application/xml");
  if (document.getElementsByTagName("parsererror").length > 0) {
    return none();
  }
  return some(document);
}

function renderNode(node: Node, path: string): VNode | string {
  if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
    return textValue(node);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const element = node as Element;
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

function renderSection(element: Element, path: string): VNode {
  return h(
    "section",
    {
      key: path,
      class: "body-section",
    },
    renderChildNodes(element, path),
  );
}

function renderStep(element: Element, path: string): VNode {
  const n = attributeOption(element, "n");
  return h(
    "div",
    {
      key: path,
      class: "body-step",
    },
    isSome(n) ? h("span", { class: "body-step-number" }, n.value) : "",
    h("div", { class: "body-step-content" }, renderChildNodes(element, path)),
  );
}

function renderFormula(element: Element, path: string): VNode {
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
  return h(
    displayMode ? "div" : "span",
    {
      key: path,
      class: displayMode ? "body-formula body-formula-block" : "body-formula body-formula-inline",
      role: "math",
      "aria-label": altText,
      title: altText,
      innerHTML: html,
    },
  );
}

function renderFigureRef(element: Element, path: string): VNode {
  const caption = firstDirectChild(element, "caption");
  return h(
    "figure",
    { key: path, class: "body-figure-ref" },
    h("figcaption", {}, isSome(caption) ? renderChildNodes(caption.value, `${path}/caption`) : "figureRef"),
  );
}

function renderGap(element: Element, path: string): VNode {
  const reason = optionValueOr(attributeOption(element, "reason"), "unreadable");
  const extent = optionValueOr(attributeOption(element, "extent"), "");
  const unit = optionValueOr(attributeOption(element, "unit"), "");
  const suffix = [extent, unit].filter((part) => part.length > 0).join(" ");
  const label = suffix.length > 0 ? `[gap: ${reason}, ${suffix}]` : `[gap: ${reason}]`;
  return h("span", { key: path, class: "body-gap" }, label);
}

function renderChildNodes(element: Element, path: string): Array<VNode | string> {
  const nodes: Array<VNode | string> = [];
  for (let index = 0; index < element.childNodes.length; index += 1) {
    const child = nullableOption(element.childNodes.item(index));
    if (isSome(child) && shouldRenderBodyNode(child.value)) {
      nodes.push(renderNode(child.value, `${path}/${String(index)}`));
    }
  }
  return nodes;
}

function shouldRenderBodyNode(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
    return textValue(node).trim().length > 0;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }
  return !BODY_DISPLAY_SKIPPED_ELEMENTS.has((node as Element).localName);
}

function firstElementByLocalName(document: Document, localName: string): Option<Element> {
  const namespaced = document.getElementsByTagNameNS(STUDYPRINT_NS, localName);
  const firstNamespaced = nullableOption(namespaced.item(0));
  if (isSome(firstNamespaced)) {
    return some(firstNamespaced.value);
  }
  const fallback = document.getElementsByTagName(localName);
  const firstFallback = nullableOption(fallback.item(0));
  return isSome(firstFallback) ? some(firstFallback.value) : none();
}

function firstDirectChild(element: Element, localName: string): Option<Element> {
  for (let index = 0; index < element.children.length; index += 1) {
    const child = nullableOption(element.children.item(index));
    if (isSome(child) && child.value.localName === localName) {
      return some(child.value);
    }
  }
  return none();
}

function attributeOption(element: Element, name: string): Option<string> {
  const value = nullableOption(element.getAttribute(name));
  return isSome(value) ? some(value.value) : none();
}

function normalizedFormulaText(element: Element): string {
  return textContent(element).replace(/\s+/g, " ").trim();
}

function formulaAltText(element: Element, fallback: string): string {
  const altTextElement = firstDirectChild(element, "altText");
  if (!isSome(altTextElement)) {
    return fallback;
  }
  const text = normalizedFormulaText(altTextElement.value);
  return text.length > 0 ? text : fallback;
}

function textContent(element: Element): string {
  const values: string[] = [];
  for (let index = 0; index < element.childNodes.length; index += 1) {
    const child = nullableOption(element.childNodes.item(index));
    if (isSome(child)) {
      values.push(textValue(child.value));
    }
  }
  return values.join("");
}

function textValue(node: Node): string {
  return optionValueOr(nullableOption(node.nodeValue), "");
}

function nullableOption<T>(value: T | null): Option<T> {
  return value === null ? none() : some(value);
}
