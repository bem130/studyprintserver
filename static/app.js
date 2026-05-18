const MAX_DARK_PIXELS = 7_000_000;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

const state = {
  items: [],
  filtered: [],
  selectedId: null,
  tag: "",
  theme: localStorage.getItem("studyprint-theme") || "light",
  imageTone: localStorage.getItem("studyprint-image-tone") || "auto",
  rotation: 0,
  zoom: 1,
  imageToken: 0,
};

const els = {
  statusLine: document.querySelector("#statusLine"),
  metricContents: document.querySelector("#metricContents"),
  metricFields: document.querySelector("#metricFields"),
  metricFormulas: document.querySelector("#metricFormulas"),
  searchInput: document.querySelector("#searchInput"),
  fieldSelect: document.querySelector("#fieldSelect"),
  dateSelect: document.querySelector("#dateSelect"),
  tagList: document.querySelector("#tagList"),
  resultCount: document.querySelector("#resultCount"),
  contentList: document.querySelector("#contentList"),
  detailTitle: document.querySelector("#detailTitle"),
  detailMeta: document.querySelector("#detailMeta"),
  previewPane: document.querySelector("#previewPane"),
  imageStage: document.querySelector("#imageStage"),
  detailImage: document.querySelector("#detailImage"),
  darkImageCanvas: document.querySelector("#darkImageCanvas"),
  openImage: document.querySelector("#openImage"),
  detailTags: document.querySelector("#detailTags"),
  detailText: document.querySelector("#detailText"),
  themeToggle: document.querySelector("#themeToggle"),
  imageToneToggle: document.querySelector("#imageToneToggle"),
  rotateLeft: document.querySelector("#rotateLeft"),
  rotateRight: document.querySelector("#rotateRight"),
  zoomOut: document.querySelector("#zoomOut"),
  zoomIn: document.querySelector("#zoomIn"),
  resetView: document.querySelector("#resetView"),
  fullscreenButton: document.querySelector("#fullscreenButton"),
};

async function boot() {
  applyTheme();
  wireControls();

  const response = await fetch("/api/contents");
  if (!response.ok) {
    throw new Error(`failed to load contents: ${response.status}`);
  }
  state.items = await response.json();
  state.filtered = state.items.slice();
  buildFilters();
  render();
  selectItem(state.filtered[0]?.global_content_id ?? null);
  els.statusLine.textContent = "Index loaded";
}

function wireControls() {
  els.searchInput.addEventListener("input", render);
  els.fieldSelect.addEventListener("change", render);
  els.dateSelect.addEventListener("change", render);
  els.themeToggle.addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    localStorage.setItem("studyprint-theme", state.theme);
    applyTheme();
    applyImageTone();
  });
  els.imageToneToggle.addEventListener("click", () => {
    state.imageTone = nextToneMode(state.imageTone);
    localStorage.setItem("studyprint-image-tone", state.imageTone);
    updateToneButton();
    applyImageTone();
  });
  els.rotateLeft.addEventListener("click", () => rotateBy(-90));
  els.rotateRight.addEventListener("click", () => rotateBy(90));
  els.zoomOut.addEventListener("click", () => setZoom(state.zoom - ZOOM_STEP));
  els.zoomIn.addEventListener("click", () => setZoom(state.zoom + ZOOM_STEP));
  els.resetView.addEventListener("click", resetView);
  els.fullscreenButton.addEventListener("click", toggleFullscreen);
  els.detailImage.addEventListener("load", () => {
    state.imageToken += 1;
    drawDarkImageIfNeeded(state.imageToken);
    updateImageLayout();
  });
  document.addEventListener("fullscreenchange", () => {
    updateFullscreenButton();
    updateImageLayout();
  });
  window.addEventListener("resize", updateImageLayout);
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  els.themeToggle.textContent = state.theme === "dark" ? "Light" : "Dark";
  els.themeToggle.classList.toggle("active", state.theme === "dark");
  updateToneButton();
}

function nextToneMode(mode) {
  if (mode === "auto") return "inverted";
  if (mode === "inverted") return "original";
  return "auto";
}

function toneIsInverted() {
  return state.imageTone === "inverted" || (state.imageTone === "auto" && state.theme === "dark");
}

function updateToneButton() {
  const active = toneIsInverted();
  const label =
    state.imageTone === "auto"
      ? "Auto"
      : state.imageTone === "inverted"
        ? "Invert"
        : "Paper";
  els.imageToneToggle.textContent = label;
  els.imageToneToggle.classList.toggle("active", active);
}

function buildFilters() {
  const fields = countBy(state.items, (item) => item.primary_field_path);
  const dates = countBy(state.items, (item) => item.logical_date);
  const tags = countBy(
    state.items.flatMap((item) => item.tags),
    (tag) => tag,
  );

  fillSelect(els.fieldSelect, "All fields", fields);
  fillSelect(els.dateSelect, "All dates", dates);

  els.tagList.innerHTML = "";
  [...tags.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"))
    .slice(0, 28)
    .forEach(([tag, count]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tag-button";
      button.textContent = `${tag} ${count}`;
      button.dataset.tag = tag;
      button.addEventListener("click", () => {
        state.tag = state.tag === tag ? "" : tag;
        render();
      });
      els.tagList.append(button);
    });
}

function fillSelect(select, label, counts) {
  select.innerHTML = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = label;
  select.append(all);

  [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "ja"))
    .forEach(([value, count]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = `${value} (${count})`;
      select.append(option);
    });
}

function countBy(values, keyFn) {
  const counts = new Map();
  values.forEach((value) => {
    const key = keyFn(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return counts;
}

function render() {
  const query = els.searchInput.value.trim().toLowerCase();
  const field = els.fieldSelect.value;
  const date = els.dateSelect.value;

  state.filtered = state.items.filter((item) => {
    const searchable = [
      item.title,
      item.primary_field_path,
      item.print_id,
      item.text,
      item.tags.join(" "),
    ]
      .join(" ")
      .toLowerCase();
    return (
      (!query || searchable.includes(query)) &&
      (!field || item.primary_field_path === field) &&
      (!date || item.logical_date === date) &&
      (!state.tag || item.tags.includes(state.tag))
    );
  });

  els.metricContents.textContent = state.items.length;
  els.metricFields.textContent = new Set(
    state.items.map((item) => item.primary_field_ref),
  ).size;
  els.metricFormulas.textContent = state.items.reduce(
    (sum, item) => sum + item.formula_count,
    0,
  );
  els.resultCount.textContent = state.filtered.length;
  [...els.tagList.children].forEach((button) => {
    button.classList.toggle("active", button.dataset.tag === state.tag);
  });
  renderList();
}

function renderList() {
  els.contentList.innerHTML = "";
  if (state.filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No matching pages.";
    els.contentList.append(empty);
    selectItem(null);
    return;
  }

  state.filtered.forEach((item) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "content-row";
    row.classList.toggle("active", item.global_content_id === state.selectedId);
    row.addEventListener("click", () => selectItem(item.global_content_id));

    const title = document.createElement("div");
    title.className = "row-title";
    title.textContent = item.title;

    const meta = document.createElement("div");
    meta.className = "row-meta";
    meta.textContent = `${item.logical_date} / ${item.primary_field_path}`;

    const text = document.createElement("div");
    text.className = "row-text";
    text.textContent = item.text.slice(0, 140);

    row.append(title, meta, text);
    els.contentList.append(row);
  });
}

function selectItem(id) {
  state.selectedId = id;
  const item = state.items.find((candidate) => candidate.global_content_id === id);
  if (!item) {
    els.detailTitle.textContent = "Select a page";
    els.detailMeta.textContent = "";
    els.detailImage.removeAttribute("src");
    els.darkImageCanvas.width = 0;
    els.darkImageCanvas.height = 0;
    els.openImage.href = "#";
    els.detailTags.innerHTML = "";
    els.detailText.textContent = "";
    return;
  }

  state.imageToken += 1;
  resetViewStateOnly();
  els.previewPane.classList.remove("tone-inverted", "tone-processing");
  els.detailTitle.textContent = item.title;
  els.detailMeta.textContent = `${item.print_id} / ${item.logical_date} / ${item.primary_field_path}`;
  els.detailImage.src = item.image_url;
  els.detailImage.alt = item.title;
  els.openImage.href = item.image_url;
  els.detailText.textContent = item.text;
  els.detailTags.innerHTML = "";
  item.tags.forEach((tag) => {
    const span = document.createElement("span");
    span.className = "tag";
    span.textContent = tag;
    els.detailTags.append(span);
  });
  renderList();
}

function rotateBy(degrees) {
  state.rotation = normalizeRotation(state.rotation + degrees);
  updateImageLayout();
}

function setZoom(zoom) {
  state.zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  updateImageLayout();
}

function resetView() {
  resetViewStateOnly();
  updateImageLayout();
}

function resetViewStateOnly() {
  state.rotation = 0;
  state.zoom = 1;
}

function normalizeRotation(value) {
  return ((value % 360) + 360) % 360;
}

function updateImageLayout() {
  const source = currentImageSource();
  if (!source.width || !source.height) {
    return;
  }

  const padding = 24;
  const boxW = Math.max(120, els.previewPane.clientWidth - padding);
  const boxH = Math.max(120, els.previewPane.clientHeight - padding);
  const rotated = state.rotation % 180 !== 0;
  const boundW = rotated ? source.height : source.width;
  const boundH = rotated ? source.width : source.height;
  const fit = Math.min(boxW / boundW, boxH / boundH);
  const scale = fit * state.zoom;
  const mediaW = Math.max(1, Math.round(source.width * scale));
  const mediaH = Math.max(1, Math.round(source.height * scale));
  const stageW = rotated ? mediaH : mediaW;
  const stageH = rotated ? mediaW : mediaH;

  els.imageStage.style.width = `${stageW}px`;
  els.imageStage.style.height = `${stageH}px`;
  els.imageStage.style.setProperty("--rotation", `${state.rotation}deg`);
  for (const node of [els.detailImage, els.darkImageCanvas]) {
    node.style.width = `${mediaW}px`;
    node.style.height = `${mediaH}px`;
  }
}

function currentImageSource() {
  if (toneIsInverted() && els.darkImageCanvas.width && els.darkImageCanvas.height) {
    return {
      width: els.darkImageCanvas.width,
      height: els.darkImageCanvas.height,
    };
  }
  return {
    width: els.detailImage.naturalWidth,
    height: els.detailImage.naturalHeight,
  };
}

function applyImageTone() {
  updateToneButton();
  if (!toneIsInverted()) {
    els.previewPane.classList.remove("tone-inverted", "tone-processing");
    updateImageLayout();
    return;
  }
  drawDarkImageIfNeeded(++state.imageToken);
}

async function drawDarkImageIfNeeded(token) {
  if (!toneIsInverted() || !els.detailImage.complete || !els.detailImage.naturalWidth) {
    updateImageLayout();
    return;
  }

  els.previewPane.classList.add("tone-processing");
  els.previewPane.classList.remove("tone-inverted");
  await new Promise((resolve) => requestAnimationFrame(resolve));
  if (token !== state.imageToken || !toneIsInverted()) {
    return;
  }

  const { width, height } = scaledCanvasSize(
    els.detailImage.naturalWidth,
    els.detailImage.naturalHeight,
  );
  const canvas = els.darkImageCanvas;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    els.previewPane.classList.remove("tone-processing");
    return;
  }
  context.drawImage(els.detailImage, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  const completed = await invertLightnessPreserveHue(imageData.data, token);
  if (!completed) {
    return;
  }
  context.putImageData(imageData, 0, 0);

  if (token !== state.imageToken || !toneIsInverted()) {
    return;
  }
  els.previewPane.classList.remove("tone-processing");
  els.previewPane.classList.add("tone-inverted");
  updateImageLayout();
}

function scaledCanvasSize(width, height) {
  const pixels = width * height;
  if (pixels <= MAX_DARK_PIXELS) {
    return { width, height };
  }
  const scale = Math.sqrt(MAX_DARK_PIXELS / pixels);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function invertLightnessPreserveHue(data, token) {
  const chunkSize = 220_000 * 4;
  for (let i = 0; i < data.length; i += 4) {
    const lab = srgbToOklab(data[i], data[i + 1], data[i + 2]);
    const invertedL = clamp(1 - lab.l, 0, 1);
    const rgb = oklabToDisplaySrgb(invertedL, lab.a, lab.b);
    data[i] = rgb.r;
    data[i + 1] = rgb.g;
    data[i + 2] = rgb.b;
    if (i > 0 && i % chunkSize === 0) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      if (token !== state.imageToken || !toneIsInverted()) {
        return false;
      }
    }
  }
  return true;
}

function srgbToOklab(r8, g8, b8) {
  const r = srgbToLinear(r8 / 255);
  const g = srgbToLinear(g8 / 255);
  const b = srgbToLinear(b8 / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function oklabToDisplaySrgb(l, a, b) {
  let chroma = 1;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const rgb = oklabToLinearSrgb(l, a * chroma, b * chroma);
    if (inGamut(rgb)) {
      return {
        r: linearToByte(rgb.r),
        g: linearToByte(rgb.g),
        b: linearToByte(rgb.b),
      };
    }
    chroma *= 0.82;
  }
  const rgb = oklabToLinearSrgb(l, a * chroma, b * chroma);
  return {
    r: linearToByte(clamp(rgb.r, 0, 1)),
    g: linearToByte(clamp(rgb.g, 0, 1)),
    b: linearToByte(clamp(rgb.b, 0, 1)),
  };
}

function oklabToLinearSrgb(l, a, b) {
  const lPrime = l + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = l - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = l - 0.0894841775 * a - 1.291485548 * b;
  const l3 = lPrime * lPrime * lPrime;
  const m3 = mPrime * mPrime * mPrime;
  const s3 = sPrime * sPrime * sPrime;
  return {
    r: 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    g: -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    b: -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  };
}

function inGamut(rgb) {
  return (
    rgb.r >= 0 &&
    rgb.r <= 1 &&
    rgb.g >= 0 &&
    rgb.g <= 1 &&
    rgb.b >= 0 &&
    rgb.b <= 1
  );
}

function srgbToLinear(value) {
  return value <= 0.04045
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
}

function linearToByte(value) {
  const encoded =
    value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  return Math.round(clamp(encoded, 0, 1) * 255);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement === els.previewPane) {
      await document.exitFullscreen();
    } else {
      await els.previewPane.requestFullscreen();
    }
  } catch (error) {
    els.statusLine.textContent = `Fullscreen failed: ${error.message}`;
    els.statusLine.style.color = "var(--warn)";
  }
}

function updateFullscreenButton() {
  const active = document.fullscreenElement === els.previewPane;
  els.fullscreenButton.textContent = active ? "Exit" : "Full";
  els.fullscreenButton.classList.toggle("active", active);
}

boot().catch((error) => {
  els.statusLine.textContent = error.message;
  els.statusLine.style.color = "var(--warn)";
});
