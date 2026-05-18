const state = {
  items: [],
  filtered: [],
  selectedId: null,
  tag: "",
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
  detailImage: document.querySelector("#detailImage"),
  openImage: document.querySelector("#openImage"),
  detailTags: document.querySelector("#detailTags"),
  detailText: document.querySelector("#detailText"),
};

async function boot() {
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
    els.openImage.href = "#";
    els.detailTags.innerHTML = "";
    els.detailText.textContent = "";
    return;
  }

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

els.searchInput.addEventListener("input", render);
els.fieldSelect.addEventListener("change", render);
els.dateSelect.addEventListener("change", render);

boot().catch((error) => {
  els.statusLine.textContent = error.message;
  els.statusLine.style.color = "var(--warn)";
});
