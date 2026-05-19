import { isSome, none, optionMap, optionValueOr, some } from "./option.js";
const listeners = new WeakMap();
export function h(tag, props = {}, ...children) {
    const node = {
        tag,
        props,
        children: normalizeChildren(children),
        key: propKey(props),
    };
    return node;
}
export function mount(parent, node) {
    parent.replaceChildren(createElement(node));
    return node;
}
export function patch(parent, oldNode, newNode) {
    const firstChild = firstChildOption(parent);
    if (!isSome(firstChild)) {
        return mount(parent, newNode);
    }
    patchNode(parent, firstChild.value, oldNode, newNode);
    return newNode;
}
function normalizeChildren(children) {
    const normalized = [];
    for (const child of children) {
        if (Array.isArray(child)) {
            normalized.push(...normalizeChildren(child));
        }
        else {
            normalized.push(typeof child === "object" ? child : String(child));
        }
    }
    return normalized;
}
function createElement(node) {
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
function patchNode(parent, domNode, oldNode, newNode) {
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
function patchChildren(parent, oldChildren, newChildren) {
    const oldKeyed = keyedChildren(oldChildren, parent.childNodes);
    const nextDomChildren = [];
    for (let index = 0; index < newChildren.length; index += 1) {
        const newChild = arrayItem(newChildren, index);
        if (!isSome(newChild))
            continue;
        const key = vnodeKey(newChild.value);
        const keyed = isSome(key)
            ? mapItem(oldKeyed, key.value)
            : none();
        const currentDom = isSome(keyed)
            ? some(keyed.value.dom)
            : childNode(parent.childNodes, index);
        const oldChild = isSome(keyed)
            ? some(keyed.value.node)
            : arrayItem(oldChildren, index);
        if (!isSome(currentDom) || !isSome(oldChild)) {
            const created = createElement(newChild.value);
            parent.append(created);
            nextDomChildren.push(created);
        }
        else {
            nextDomChildren.push(patchNode(parent, currentDom.value, oldChild.value, newChild.value));
        }
    }
    while (parent.childNodes.length > newChildren.length) {
        const extra = childNode(parent.childNodes, newChildren.length);
        if (isSome(extra))
            extra.value.remove();
        else
            return;
    }
    nextDomChildren.forEach((child, index) => {
        if (parent.childNodes[index] !== child) {
            const before = childNode(parent.childNodes, index);
            insertChild(parent, child, before);
        }
    });
}
function insertChild(parent, child, before) {
    if (isSome(before))
        parent.insertBefore(child, before.value);
    else
        parent.append(child);
}
function keyedChildren(children, nodes) {
    const keyed = new Map();
    children.forEach((child, index) => {
        const key = vnodeKey(child);
        if (isSome(key)) {
            const dom = childNode(nodes, index);
            if (isSome(dom) && typeof child !== "string")
                keyed.set(key.value, { node: child, dom: dom.value });
        }
    });
    return keyed;
}
function patchProps(element, oldProps, newProps) {
    const names = new Set([...Object.keys(oldProps), ...Object.keys(newProps)]);
    for (const name of names) {
        if (name === "key")
            continue;
        const oldValue = propValue(oldProps, name);
        const newValue = propValue(newProps, name);
        if (name === "innerHTML") {
            setProp(element, name, oldValue, newValue);
            continue;
        }
        if (optionSame(oldValue, newValue))
            continue;
        setProp(element, name, oldValue, newValue);
    }
}
function optionSame(left, right) {
    if (!isSome(left) && !isSome(right))
        return true;
    return isSome(left) && isSome(right) && left.value === right.value;
}
function setProp(element, name, oldValue, newValue) {
    if (name.startsWith("on")) {
        setListener(element, name.slice(2).toLowerCase(), newValue);
        return;
    }
    if (name === "style") {
        setStyle(element, oldValue, newValue);
        return;
    }
    if (name === "innerHTML") {
        setInnerHtml(element, newValue);
        return;
    }
    if (name === "value" && "value" in element) {
        const value = optionValueOr(optionMap(newValue, (value) => String(value)), "");
        if (element.value !== value) {
            element.value = value;
        }
        return;
    }
    if (name === "disabled" && name in element) {
        const enabled = isSome(newValue) && Boolean(newValue.value);
        element.disabled = enabled;
        if (!enabled)
            element.removeAttribute(name);
        else
            element.setAttribute(name, "");
        return;
    }
    setAttribute(element, name, newValue);
}
function hasInnerHtml(props) {
    const value = propValue(props, "innerHTML");
    return isSome(value) && typeof value.value === "string";
}
function setInnerHtml(element, value) {
    element.innerHTML = isSome(value) && typeof value.value === "string" ? value.value : "";
}
function setListener(element, eventName, newValue) {
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
        const listener = newValue.value;
        element.addEventListener(eventName, listener);
        elementListeners.set(eventName, listener);
    }
}
function setStyle(element, oldValue, newValue) {
    if (isSome(oldValue) && typeof oldValue.value === "object" && oldValue.value) {
        for (const key of Object.keys(oldValue.value)) {
            element.style.removeProperty(kebab(key));
        }
    }
    if (isSome(newValue) && typeof newValue.value === "object" && newValue.value) {
        for (const [key, value] of Object.entries(newValue.value)) {
            element.style.setProperty(kebab(key), value);
        }
        return;
    }
    element.removeAttribute("style");
}
function setAttribute(element, name, value) {
    if (!isSome(value) || value.value === false) {
        element.removeAttribute(name);
        return;
    }
    element.setAttribute(name, value.value === true ? "" : String(value.value));
}
function kebab(name) {
    return name.startsWith("--")
        ? name
        : name.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}
function firstChildOption(parent) {
    return childNode(parent.childNodes, 0);
}
function arrayItem(values, index) {
    if (index in values)
        return some(values[index]);
    return none();
}
function childNode(nodes, index) {
    if (index in nodes)
        return some(nodes[index]);
    return none();
}
function mapItem(map, key) {
    if (map.has(key))
        return some(map.get(key));
    return none();
}
function propValue(props, name) {
    if (Object.prototype.hasOwnProperty.call(props, name))
        return some(props[name]);
    return none();
}
function vnodeKey(node) {
    if (typeof node === "string")
        return none();
    return node.key;
}
function propKey(props) {
    const key = propValue(props, "key");
    if (isSome(key) && typeof key.value === "string")
        return some(key.value);
    return none();
}
function optionStringSame(left, right) {
    if (!isSome(left) && !isSome(right))
        return true;
    return isSome(left) && isSome(right) && left.value === right.value;
}
