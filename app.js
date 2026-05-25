const state = {
  data: null,
  currentListId: "",
  selectedDays: new Set(),
  checked: new Set(),
  hideChecked: false,
  collapsed: false,
};

const els = {
  listSelect: document.querySelector("#listSelect"),
  dayButtons: document.querySelector("#dayButtons"),
  allDaysButton: document.querySelector("#allDaysButton"),
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

function daysStorageKey() {
  return `shopping-list:${state.currentListId}:days`;
}

function loadChecked() {
  const stored = localStorage.getItem(storageKey());
  state.checked = new Set(stored ? JSON.parse(stored) : []);
}

function saveChecked() {
  localStorage.setItem(storageKey(), JSON.stringify([...state.checked]));
}

function loadSelectedDays() {
  const list = currentList();
  const allDays = list?.days?.map((day) => day.name) || [];
  const stored = localStorage.getItem(daysStorageKey());
  const selected = stored ? JSON.parse(stored).filter((day) => allDays.includes(day)) : allDays;
  state.selectedDays = new Set(selected.length ? selected : allDays);
}

function saveSelectedDays() {
  localStorage.setItem(daysStorageKey(), JSON.stringify([...state.selectedDays]));
}

function currentList() {
  return state.data?.lists.find((list) => list.id === state.currentListId);
}

function itemKey(categoryName, item) {
  return `${state.currentListId}:${categoryName}:${item.id}`;
}

function allItems(list = currentList()) {
  return visibleCategories(list).flatMap((category) =>
    category.items.map((item) => ({ categoryName: category.name, item })),
  );
}

function visibleCategories(list = currentList()) {
  if (!list) return [];
  if (!list.days?.length) return list.categories;

  const categoryOrder = list.categories.map((category) => category.name);
  const aggregates = new Map();

  list.days
    .filter((day) => state.selectedDays.has(day.name))
    .flatMap((day) => day.items)
    .forEach((item) => {
      const key = `${item.category}:${item.id}`;
      const grams = Number.parseInt(item.quantity, 10);
      const current = aggregates.get(key) || {
        id: item.id,
        name: item.name,
        category: item.category,
        grams: 0,
        quantities: [],
      };
      if (Number.isFinite(grams) && item.quantity.endsWith("g")) {
        current.grams += grams;
      } else {
        current.quantities.push(item.quantity);
      }
      aggregates.set(key, current);
    });

  return categoryOrder
    .map((categoryName) => {
      const items = [...aggregates.values()]
        .filter((item) => item.category === categoryName)
        .map((item) => ({
          id: item.id,
          name: item.name,
          quantity: item.grams ? `${item.grams}g` : item.quantities.join(", "),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "pl"));
      return { name: categoryName, items };
    })
    .filter((category) => category.items.length);
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

function renderDayButtons() {
  const list = currentList();
  const days = list?.days || [];
  els.dayButtons.replaceChildren(
    ...days.map((day) => {
      const button = document.createElement("button");
      const active = state.selectedDays.has(day.name);
      button.type = "button";
      button.className = active ? "active" : "";
      button.textContent = day.name.slice(0, 3);
      button.title = day.name;
      button.setAttribute("aria-pressed", String(active));
      button.addEventListener("click", () => {
        if (state.selectedDays.has(day.name)) {
          state.selectedDays.delete(day.name);
        } else {
          state.selectedDays.add(day.name);
        }
        saveSelectedDays();
        renderDayButtons();
        renderList();
      });
      return button;
    }),
  );
}

function renderList() {
  const list = currentList();
  const categories = visibleCategories(list);
  els.shoppingList.replaceChildren();
  els.emptyState.hidden = Boolean(list);
  if (!list) {
    updateSummary();
    return;
  }

  els.emptyState.hidden = categories.length > 0;
  if (!categories.length) {
    els.emptyState.textContent = "Wybierz przynajmniej jeden dzień.";
  }

  const nodes = categories.map((category) => {
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
        const scrollY = window.scrollY;
        if (checkbox.checked) {
          state.checked.add(key);
        } else {
          state.checked.delete(key);
        }
        saveChecked();
        renderList();
        requestAnimationFrame(() => window.scrollTo({ top: scrollY }));
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
    loadSelectedDays();
    renderDayButtons();
    renderList();
  });

  els.allDaysButton.addEventListener("click", () => {
    const list = currentList();
    const days = list?.days?.map((day) => day.name) || [];
    const allSelected = days.every((day) => state.selectedDays.has(day));
    state.selectedDays = new Set(allSelected ? [] : days);
    saveSelectedDays();
    renderDayButtons();
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
  loadSelectedDays();
  bindControls();
  renderDayButtons();
  renderList();
}

init().catch(() => {
  els.emptyState.hidden = false;
  els.emptyState.textContent = "Nie udało się wczytać listy.";
});
