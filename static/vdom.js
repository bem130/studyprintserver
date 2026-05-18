const listeners = new WeakMap();
export function h(tag, props = {}, ...children) {
    const node = {
        tag,
        props,
        children: normalizeChildren(children),
    };
    if (typeof props.key === "string") {
        node.key = props.key;
    }
    return node;
}
export function mount(parent, node) {
    parent.replaceChildren(createElement(node));
    return node;
}
export function patch(parent, oldNode, newNode) {
    if (!oldNode || !parent.firstChild) {
        return mount(parent, newNode);
    }
    patchNode(parent, parent.firstChild, oldNode, newNode);
    return newNode;
}
function normalizeChildren(children) {
    const normalized = [];
    for (const child of children) {
        if (Array.isArray(child)) {
            normalized.push(...normalizeChildren(child));
        }
        else if (child != null && child !== false) {
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
    for (const child of node.children) {
        element.append(createElement(child));
    }
    patchProps(element, {}, node.props);
    return element;
}
function patchNode(parent, domNode, oldNode, newNode) {
    if (typeof oldNode === "string" || typeof newNode === "string") {
        if (oldNode !== newNode) {
            parent.replaceChild(createElement(newNode), domNode);
        }
        return;
    }
    if (oldNode.tag !== newNode.tag || oldNode.key !== newNode.key) {
        parent.replaceChild(createElement(newNode), domNode);
        return;
    }
    if (!(domNode instanceof Element)) {
        parent.replaceChild(createElement(newNode), domNode);
        return;
    }
    patchChildren(domNode, oldNode.children, newNode.children);
    patchProps(domNode, oldNode.props, newNode.props);
}
function patchChildren(parent, oldChildren, newChildren) {
    const oldKeyed = keyedChildren(oldChildren, parent.childNodes);
    const nextDomChildren = [];
    for (let index = 0; index < newChildren.length; index += 1) {
        const newChild = newChildren[index];
        if (newChild == null)
            continue;
        const key = typeof newChild === "string" ? undefined : newChild.key;
        const keyed = key ? oldKeyed.get(key) : undefined;
        const currentDom = keyed?.dom ?? parent.childNodes[index] ?? null;
        const oldChild = keyed?.node ?? oldChildren[index];
        if (!currentDom || oldChild == null) {
            const created = createElement(newChild);
            parent.append(created);
            nextDomChildren.push(created);
        }
        else {
            patchNode(parent, currentDom, oldChild, newChild);
            nextDomChildren.push(currentDom);
        }
    }
    while (parent.childNodes.length > newChildren.length) {
        parent.lastChild?.remove();
    }
    nextDomChildren.forEach((child, index) => {
        if (parent.childNodes[index] !== child) {
            parent.insertBefore(child, parent.childNodes[index] ?? null);
        }
    });
}
function keyedChildren(children, nodes) {
    const keyed = new Map();
    children.forEach((child, index) => {
        if (typeof child !== "string" && child.key) {
            const dom = nodes[index];
            if (dom)
                keyed.set(child.key, { node: child, dom });
        }
    });
    return keyed;
}
function patchProps(element, oldProps, newProps) {
    const names = new Set([...Object.keys(oldProps), ...Object.keys(newProps)]);
    for (const name of names) {
        if (name === "key")
            continue;
        const oldValue = oldProps[name];
        const newValue = newProps[name];
        if (oldValue === newValue)
            continue;
        setProp(element, name, oldValue, newValue);
    }
}
function setProp(element, name, oldValue, newValue) {
    if (name.startsWith("on") && typeof newValue !== "string") {
        setListener(element, name.slice(2).toLowerCase(), oldValue, newValue);
        return;
    }
    if (name === "className") {
        setAttribute(element, "class", newValue);
        return;
    }
    if (name === "style") {
        setStyle(element, oldValue, newValue);
        return;
    }
    if (name === "value" && "value" in element) {
        const value = newValue == null ? "" : String(newValue);
        if (element.value !== value) {
            element.value = value;
        }
        return;
    }
    if ((name === "checked" || name === "disabled" || name === "selected") && name in element) {
        element[name] = Boolean(newValue);
        if (!newValue)
            element.removeAttribute(name);
        else
            element.setAttribute(name, "");
        return;
    }
    setAttribute(element, name, newValue);
}
function setListener(element, eventName, oldValue, newValue) {
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
    if (typeof newValue === "function") {
        const listener = newValue;
        element.addEventListener(eventName, listener);
        elementListeners.set(eventName, listener);
    }
}
function setStyle(element, oldValue, newValue) {
    if (typeof oldValue === "object" && oldValue) {
        for (const key of Object.keys(oldValue)) {
            element.style.removeProperty(kebab(key));
        }
    }
    if (typeof newValue === "string") {
        element.setAttribute("style", newValue);
        return;
    }
    if (typeof newValue === "object" && newValue) {
        for (const [key, value] of Object.entries(newValue)) {
            element.style.setProperty(kebab(key), value);
        }
        return;
    }
    element.removeAttribute("style");
}
function setAttribute(element, name, value) {
    if (value == null || value === false) {
        element.removeAttribute(name);
        return;
    }
    element.setAttribute(name, value === true ? "" : String(value));
}
function kebab(name) {
    return name.startsWith("--")
        ? name
        : name.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}
