import { isSome, none, optionMap, optionValueOr, some, type Option } from "./option.js";

export type VPrimitiveChild = VNode | string | number;
export type VChild = VPrimitiveChild | VPrimitiveChild[];

export interface VNode {
  tag: string;
  props: VProps;
  children: Array<VNode | string>;
  key: Option<string>;
}

export type VStyle = Record<string, string>;
export type VEventHandler =
  | ((event: Event) => void)
  | ((event: KeyboardEvent) => void)
  | ((event: PointerEvent) => void);
export type VPropValue = string | number | boolean | VStyle | VEventHandler;
export type VProps = Record<string, VPropValue>;

const listeners = new WeakMap<Element, Map<string, EventListener>>();

type DisableableElement = HTMLElement & { disabled: boolean };

export function h(tag: string, props: VProps = {}, ...children: VChild[]): VNode {
  const node: VNode = {
    tag,
    props,
    children: normalizeChildren(children),
    key: propKey(props),
  };
  return node;
}

export function mount(parent: Element, node: VNode): VNode {
  parent.replaceChildren(createElement(node));
  return node;
}

export function patch(parent: Element, oldNode: VNode, newNode: VNode): VNode {
  const firstChild = firstChildOption(parent);
  if (!isSome(firstChild)) {
    return mount(parent, newNode);
  }
  patchNode(parent, firstChild.value, oldNode, newNode);
  return newNode;
}

function normalizeChildren(children: VChild[]): Array<VNode | string> {
  const normalized: Array<VNode | string> = [];
  for (const child of children) {
    if (Array.isArray(child)) {
      normalized.push(...normalizeChildren(child));
    } else {
      normalized.push(typeof child === "object" ? child : String(child));
    }
  }
  return normalized;
}

function createElement(node: VNode | string): Node {
  if (typeof node === "string") {
    return document.createTextNode(node);
  }
  const element = document.createElement(node.tag);
  if (!hasInnerHtml(node.props)) {
    for (const child of node.children) {
      element.append(createElement(child));
    }
  }
  patchProps(element, {}, node.props);
  return element;
}

function patchNode(parent: Element, domNode: Node, oldNode: VNode | string, newNode: VNode | string): Node {
  if (typeof oldNode === "string" || typeof newNode === "string") {
    if (oldNode !== newNode) {
      const replacement = createElement(newNode);
      parent.replaceChild(replacement, domNode);
      return replacement;
    }
    return domNode;
  }

  if (oldNode.tag !== newNode.tag || !optionStringSame(oldNode.key, newNode.key)) {
    const replacement = createElement(newNode);
    parent.replaceChild(replacement, domNode);
    return replacement;
  }

  if (!(domNode instanceof Element)) {
    const replacement = createElement(newNode);
    parent.replaceChild(replacement, domNode);
    return replacement;
  }

  if (hasInnerHtml(oldNode.props) || hasInnerHtml(newNode.props)) {
    patchProps(domNode, oldNode.props, newNode.props);
    return domNode;
  }

  patchChildren(domNode, oldNode.children, newNode.children);
  patchProps(domNode, oldNode.props, newNode.props);
  return domNode;
}

function patchChildren(
  parent: Element,
  oldChildren: Array<VNode | string>,
  newChildren: Array<VNode | string>,
): void {
  const oldDomChildren = Array.from(parent.childNodes);
  const oldKeyed = keyedChildren(oldChildren, oldDomChildren);
  const usedOldDom = new Set<Node>();
  const nextDomChildren: Node[] = [];
  let oldUnkeyedCursor = 0;

  for (let index = 0; index < newChildren.length; index += 1) {
    const newChild = arrayItem(newChildren, index);
    if (!isSome(newChild)) continue;
    const key = vnodeKey(newChild.value);
    const keyed = isSome(key) ? mapItem(oldKeyed, key.value) : none<{ node: VNode; dom: Node }>();
    const match = isSome(keyed)
      ? some<{ node: VNode | string; dom: Node }>(keyed.value)
      : nextUnkeyedOldChild(oldChildren, oldDomChildren, usedOldDom, oldUnkeyedCursor);
    if (!isSome(keyed)) {
      oldUnkeyedCursor = nextUnkeyedCursor(oldChildren, oldUnkeyedCursor);
    }

    if (!isSome(match)) {
      const created = createElement(newChild.value);
      parent.append(created);
      nextDomChildren.push(created);
    } else {
      usedOldDom.add(match.value.dom);
      nextDomChildren.push(patchNode(parent, match.value.dom, match.value.node, newChild.value));
    }
  }

  for (const child of Array.from(parent.childNodes)) {
    if (!nextDomChildren.includes(child)) child.remove();
  }

  nextDomChildren.forEach((child, index) => {
    if (parent.childNodes[index] !== child) {
      const before = childNode(parent.childNodes, index);
      insertChild(parent, child, before);
    }
  });
}

function insertChild(parent: Element, child: Node, before: Option<Node>): void {
  if (isSome(before)) parent.insertBefore(child, before.value);
  else parent.append(child);
}

function keyedChildren(children: Array<VNode | string>, nodes: ChildNode[]): Map<string, { node: VNode; dom: Node }> {
  const keyed = new Map<string, { node: VNode; dom: Node }>();
  children.forEach((child, index) => {
    const key = vnodeKey(child);
    if (isSome(key)) {
      const dom = arrayItem(nodes, index);
      if (isSome(dom) && typeof child !== "string") keyed.set(key.value, { node: child, dom: dom.value });
    }
  });
  return keyed;
}

function nextUnkeyedOldChild(
  oldChildren: Array<VNode | string>,
  oldDomChildren: ChildNode[],
  usedOldDom: Set<Node>,
  startIndex: number,
): Option<{ node: VNode | string; dom: Node }> {
  for (let index = startIndex; index < oldChildren.length; index += 1) {
    const oldChild = arrayItem(oldChildren, index);
    const dom = arrayItem(oldDomChildren, index);
    if (isSome(oldChild) && isSome(dom) && !isSome(vnodeKey(oldChild.value)) && !usedOldDom.has(dom.value)) {
      return some({ node: oldChild.value, dom: dom.value });
    }
  }
  return none();
}

function nextUnkeyedCursor(oldChildren: Array<VNode | string>, startIndex: number): number {
  for (let index = startIndex; index < oldChildren.length; index += 1) {
    const oldChild = arrayItem(oldChildren, index);
    if (isSome(oldChild) && !isSome(vnodeKey(oldChild.value))) {
      return index + 1;
    }
  }
  return oldChildren.length;
}

function patchProps(element: Element, oldProps: VProps, newProps: VProps): void {
  const names = new Set([...Object.keys(oldProps), ...Object.keys(newProps)]);
  for (const name of names) {
    if (name === "key") continue;
    const oldValue = propValue(oldProps, name);
    const newValue = propValue(newProps, name);
    if (name === "innerHTML") {
      setProp(element, name, oldValue, newValue);
      continue;
    }
    if (optionSame(oldValue, newValue)) continue;
    setProp(element, name, oldValue, newValue);
  }
}

function optionSame<T>(left: Option<T>, right: Option<T>): boolean {
  if (!isSome(left) && !isSome(right)) return true;
  return isSome(left) && isSome(right) && left.value === right.value;
}

function setProp(element: Element, name: string, oldValue: Option<VPropValue>, newValue: Option<VPropValue>): void {
  if (name.startsWith("on")) {
    setListener(element, name.slice(2).toLowerCase(), newValue);
    return;
  }

  if (name === "style") {
    setStyle(element as HTMLElement, oldValue, newValue);
    return;
  }

  if (name === "innerHTML") {
    setInnerHtml(element, newValue);
    return;
  }

  if (name === "value" && "value" in element) {
    const value = optionValueOr(optionMap(newValue, (value) => String(value)), "");
    if ((element as HTMLInputElement | HTMLSelectElement).value !== value) {
      (element as HTMLInputElement | HTMLSelectElement).value = value;
    }
    return;
  }

  if (name === "disabled" && name in element) {
    const enabled = isSome(newValue) && Boolean(newValue.value);
    (element as DisableableElement).disabled = enabled;
    if (!enabled) element.removeAttribute(name);
    else element.setAttribute(name, "");
    return;
  }

  setAttribute(element, name, newValue);
}

function hasInnerHtml(props: VProps): boolean {
  const value = propValue(props, "innerHTML");
  return isSome(value) && typeof value.value === "string";
}

function setInnerHtml(element: Element, value: Option<VPropValue>): void {
  element.innerHTML = isSome(value) && typeof value.value === "string" ? value.value : "";
}

function setListener(element: Element, eventName: string, newValue: Option<VPropValue>): void {
  let elementListeners = listeners.get(element);
  if (!elementListeners) {
    elementListeners = new Map();
    listeners.set(element, elementListeners);
  }

  const oldListener = elementListeners.get(eventName);
  if (oldListener) {
    element.removeEventListener(eventName, oldListener);
    elementListeners.delete(eventName);
  }

  if (isSome(newValue) && typeof newValue.value === "function") {
    const listener = newValue.value as EventListener;
    element.addEventListener(eventName, listener);
    elementListeners.set(eventName, listener);
  }
}

function setStyle(element: HTMLElement, oldValue: Option<VPropValue>, newValue: Option<VPropValue>): void {
  if (isSome(oldValue) && typeof oldValue.value === "object" && oldValue.value) {
    for (const key of Object.keys(oldValue.value)) {
      element.style.removeProperty(kebab(key));
    }
  }

  if (isSome(newValue) && typeof newValue.value === "object" && newValue.value) {
    for (const [key, value] of Object.entries(newValue.value as VStyle)) {
      element.style.setProperty(kebab(key), value);
    }
    return;
  }

  element.removeAttribute("style");
}

function setAttribute(element: Element, name: string, value: Option<VPropValue>): void {
  if (!isSome(value) || value.value === false) {
    element.removeAttribute(name);
    return;
  }
  element.setAttribute(name, value.value === true ? "" : String(value.value));
}

function kebab(name: string): string {
  return name.startsWith("--")
    ? name
    : name.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function firstChildOption(parent: Element): Option<ChildNode> {
  return childNode(parent.childNodes, 0);
}

function arrayItem<T>(values: T[], index: number): Option<T> {
  if (index in values) return some(values[index] as T);
  return none();
}

function childNode(nodes: NodeListOf<ChildNode>, index: number): Option<ChildNode> {
  if (index in nodes) return some(nodes[index] as ChildNode);
  return none();
}

function mapItem<K, V>(map: Map<K, V>, key: K): Option<V> {
  if (map.has(key)) return some(map.get(key) as V);
  return none();
}

function propValue(props: VProps, name: string): Option<VPropValue> {
  if (Object.prototype.hasOwnProperty.call(props, name)) return some(props[name] as VPropValue);
  return none();
}

function vnodeKey(node: VNode | string): Option<string> {
  if (typeof node === "string") return none();
  return node.key;
}

function propKey(props: VProps): Option<string> {
  const key = propValue(props, "key");
  if (isSome(key) && typeof key.value === "string") return some(key.value);
  return none();
}

function optionStringSame(left: Option<string>, right: Option<string>): boolean {
  if (!isSome(left) && !isSome(right)) return true;
  return isSome(left) && isSome(right) && left.value === right.value;
}
