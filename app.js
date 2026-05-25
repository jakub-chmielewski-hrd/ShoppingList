const state = {
  data: null,
  currentListId: "",
  checked: new Set(),
  hideChecked: false,
  collapsed: false,
};

const els = {
  listSelect: document.querySelector("#listSelect"),
  shoppingList: document.querySelector("#shoppingList"),
  emptyState: document.querySelector("#emptyState"),
  doneCount: document.querySelector("#doneCount"),
  totalCount: document.querySelector("#totalCount"),
  progress: document.querySelector("#progress"),
  resetButton: document.querySelector("#resetButton"),
  hideCheckedButton: document.querySelector("#hideCheckedButton"),
  expandButton: document.querySelector("#expandButton"),
};

function storageKey() {
  return `shopping-list:${state.currentListId}:checked`;
}

function loadChecked() {
  const stored = localStorage.getItem(storageKey());
  state.checked = new Set(stored ? JSON.parse(stored) : []);
}

function saveChecked() {
  localStorage.setItem(storageKey(), JSON.stringify([...state.checked]));
}

function currentList() {
  return state.data?.lists.find((list) => list.id === state.currentListId);
}

function itemKey(categoryName, item) {
  return `${state.currentListId}:${categoryName}:${item.id}`;
}

function allItems(list = currentList()) {
  if (!list) return [];
  return list.categories.flatMap((category) =>
    category.items.map((item) => ({ categoryName: category.name, item })),
  );
}

function updateSummary() {
  const total = allItems().length;
  const done = allItems().filter(({ categoryName, item }) =>
    state.checked.has(itemKey(categoryName, item)),
  ).length;
  els.doneCount.textContent = done;
  els.totalCount.textContent = total;
  els.progress.max = total || 1;
  els.progress.value = done;
}

function renderOptions() {
  els.listSelect.replaceChildren(
    ...state.data.lists.map((list) => {
      const option = document.createElement("option");
      option.value = list.id;
      option.textContent = list.title;
      return option;
    }),
  );
}

function renderList() {
  const list = currentList();
  els.shoppingList.replaceChildren();
  els.emptyState.hidden = Boolean(list);
  if (!list) {
    updateSummary();
    return;
  }

  const nodes = list.categories.map((category) => {
    const details = document.createElement("details");
    details.className = "category";
    details.open = !state.collapsed;

    const summary = document.createElement("summary");
    const title = document.createElement("span");
    title.textContent = category.name;
    const count = document.createElement("span");
    count.className = "category-count";
    summary.append(title, count);

    const items = document.createElement("div");
    items.className = "items";

    category.items.forEach((item) => {
      const key = itemKey(category.name, item);
      const checked = state.checked.has(key);

      const label = document.createElement("label");
      label.className = `item${checked ? " checked" : ""}${state.hideChecked && checked ? " hidden" : ""}`;

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = checked;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          state.checked.add(key);
        } else {
          state.checked.delete(key);
        }
        saveChecked();
        renderList();
      });

      const text = document.createElement("span");
      text.className = "item-text";
      const name = document.createElement("span");
      name.className = "item-name";
      name.textContent = item.name;
      const quantity = document.createElement("span");
      quantity.className = "item-quantity";
      quantity.textContent = item.quantity;
      text.append(name, quantity);

      label.append(checkbox, text);
      items.append(label);
    });

    const done = category.items.filter((item) =>
      state.checked.has(itemKey(category.name, item)),
    ).length;
    count.textContent = `${done}/${category.items.length}`;

    details.append(summary, items);
    return details;
  });

  els.shoppingList.append(...nodes);
  updateSummary();
}

function bindControls() {
  els.listSelect.addEventListener("change", () => {
    state.currentListId = els.listSelect.value;
    loadChecked();
    renderList();
  });

  els.resetButton.addEventListener("click", () => {
    state.checked.clear();
    saveChecked();
    renderList();
  });

  els.hideCheckedButton.addEventListener("click", () => {
    state.hideChecked = !state.hideChecked;
    els.hideCheckedButton.textContent = state.hideChecked ? "Pokaż kupione" : "Ukryj kupione";
    renderList();
  });

  els.expandButton.addEventListener("click", () => {
    state.collapsed = !state.collapsed;
    els.expandButton.textContent = state.collapsed ? "Rozwiń kategorie" : "Zwiń kategorie";
    renderList();
  });
}

async function init() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  const response = await fetch("./data/shopping-lists.json", { cache: "no-store" });
  state.data = await response.json();
  state.currentListId = state.data.lists[0]?.id || "";
  renderOptions();
  loadChecked();
  bindControls();
  renderList();
}

init().catch(() => {
  els.emptyState.hidden = false;
  els.emptyState.textContent = "Nie udało się wczytać listy.";
});
