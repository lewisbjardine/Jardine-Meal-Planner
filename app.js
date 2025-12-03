// ---- CONFIG ----

// Supabase Edge Functions base URL
const SUPABASE_FUNCTION_BASE_URL =
  "https://tzrmuferszuscavbujbc.supabase.co/functions/v1";

// Public anon key from Supabase Settings → API (safe to expose in frontend)
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6cm11ZmVyc3p1c2NhdmJ1amJjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ3MTE0MDMsImV4cCI6MjA4MDI4NzQwM30.aRPM29TX1iv2dTRYQNxAGtu_LLAIbfzuKIWRcgNQaRE";

// LocalStorage key (for offline fallback)
const STORAGE_KEY = "jardineMealPlanner";

// ---- STATE ----

let state = createInitialState();
let ui = {
  currentWeekIndex: 0,
  currentContext: null // {weekIndex, dayIndex}
};

// ---- INITIAL STATE ----

function createInitialState() {
  const days = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday"
  ];
  const weeks = [];

  for (let w = 0; w < 4; w++) {
    weeks.push({
      id: `week-${w + 1}`,
      label: `Week ${w + 1}`,
      days: days.map((name, index) => ({
        id: `${w}-${index}`,
        name,
        recipeId: null,
        grannyDay: false
      }))
    });
  }

  return {
    weeks,
    recipes: {}
  };
}

// ---- LOCAL FALLBACK ----

function loadStateFromLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();
    const parsed = JSON.parse(raw);
    if (!parsed.weeks || !parsed.recipes) return createInitialState();
    return parsed;
  } catch {
    return createInitialState();
  }
}

function saveStateLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ---- CLOUD SYNC (Supabase Edge Function: state) ----

async function syncFromCloud() {
  try {
    const res = await fetch(`${SUPABASE_FUNCTION_BASE_URL}/state`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`
      },
      credentials: "omit"
    });
    if (!res.ok) throw new Error("Cloud load failed");
    const cloudState = await res.json();
    if (cloudState.weeks && cloudState.recipes) {
      state = cloudState;
    }
  } catch (e) {
    console.warn("Using local state because cloud load failed:", e);
    state = loadStateFromLocal();
  }
}

let saveTimeout = null;

async function saveState() {
  // Save locally for offline
  saveStateLocal();

  // Debounce cloud save
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    try {
      await fetch(`${SUPABASE_FUNCTION_BASE_URL}/state`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify(state)
      });
    } catch (e) {
      console.warn("Cloud save failed (will retry next change):", e);
    }
  }, 400);
}

// ---- UTILITIES ----

function $(sel) {
  return document.querySelector(sel);
}

function createElement(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

function getCurrentWeek() {
  return state.weeks[ui.currentWeekIndex];
}

function getRecipeById(id) {
  if (!id) return null;
  return state.recipes[id] || null;
}

function generateRecipeId() {
  return "r_" + Math.random().toString(36).slice(2, 10);
}

// ---- VIEW SWITCHING ----

function setActiveView(viewId) {
  document
    .querySelectorAll(".view")
    .forEach(v => v.classList.remove("view--active"));
  const view = document.getElementById(viewId);
  if (view) view.classList.add("view--active");
}

function setActiveNavButton(viewId) {
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.classList.toggle("nav-btn--active", btn.dataset.nav === viewId);
  });
}

// ---- WEEKLY VIEW RENDER ----

let draggedDay = null;

function renderWeeklyView() {
  const week = getCurrentWeek();
  $("#current-week-label").textContent = week.label;

  const grid = $("#week-grid");
  grid.innerHTML = "";

  week.days.forEach((day, dayIndex) => {
    const recipe = getRecipeById(day.recipeId);

    const card = createElement("div", "day-card");
    card.draggable = true;
    card.dataset.weekIndex = ui.currentWeekIndex;
    card.dataset.dayIndex = dayIndex;

    card.addEventListener("dragstart", onDayDragStart);
    card.addEventListener("dragover", onDayDragOver);
    card.addEventListener("dragleave", onDayDragLeave);
    card.addEventListener("drop", onDayDrop);

    card.addEventListener("click", e => {
      if (e.target.closest(".icon-btn")) return;
      if (day.grannyDay || recipe) {
        openDayDetail(ui.currentWeekIndex, dayIndex);
      } else {
        openAssignModal(ui.currentWeekIndex, dayIndex);
      }
    });

    const header = createElement("div", "day-card-header");
    const dayName = createElement("span", "day-name", day.name);
    const badges = createElement("div", "day-badges");

    if (day.grannyDay) {
      badges.appendChild(
        createElement("span", "badge badge--granny", "Granny day")
      );
    } else if (!recipe) {
      badges.appendChild(
        createElement("span", "badge badge--empty", "No meal")
      );
    }

    header.appendChild(dayName);
    header.appendChild(badges);

    const title = createElement(
      "div",
      "day-title",
      day.grannyDay
        ? "Dinner at Granny's"
        : recipe
        ? recipe.title
        : "Tap to choose a meal"
    );
    const subtitle = createElement(
      "div",
      "day-subtitle",
      recipe && recipe.disliked ? "⚠ You marked this as disliked" : ""
    );

    const actionsRow = createElement("div", "day-actions-row");
    const clearBtn = createElement("button", "icon-btn", "✖");
    clearBtn.title = "Clear this day";
    clearBtn.addEventListener("click", e => {
      e.stopPropagation();
      clearDay(ui.currentWeekIndex, dayIndex);
    });

    const grannyBtn = createElement("button", "icon-btn", "👵");
    grannyBtn.title = "Mark as Granny day";
    grannyBtn.addEventListener("click", e => {
      e.stopPropagation();
      toggleGrannyDay(ui.currentWeekIndex, dayIndex);
    });

    actionsRow.appendChild(clearBtn);
    actionsRow.appendChild(grannyBtn);

    card.appendChild(header);
    card.appendChild(title);
    if (subtitle.textContent) card.appendChild(subtitle);
    card.appendChild(actionsRow);

    grid.appendChild(card);
  });
}

// ---- DRAG & DROP DAYS ----

function onDayDragStart(e) {
  const weekIndex = Number(e.currentTarget.dataset.weekIndex);
  const dayIndex = Number(e.currentTarget.dataset.dayIndex);
  draggedDay = { weekIndex, dayIndex };
  e.dataTransfer.effectAllowed = "move";
}

function onDayDragOver(e) {
  e.preventDefault();
  const target = e.currentTarget;
  if (!target.classList.contains("drag-over")) {
    target.classList.add("drag-over");
  }
}

function onDayDragLeave(e) {
  e.currentTarget.classList.remove("drag-over");
}

function onDayDrop(e) {
  e.preventDefault();
  const target = e.currentTarget;
  target.classList.remove("drag-over");
  if (!draggedDay) return;

  const fromWeek = draggedDay.weekIndex;
  const fromDay = draggedDay.dayIndex;
  const toWeek = Number(target.dataset.weekIndex);
  const toDay = Number(target.dataset.dayIndex);

  if (fromWeek !== toWeek) return;

  const week = state.weeks[fromWeek];
  const tmp = week.days[fromDay];
  week.days[fromDay] = week.days[toDay];
  week.days[toDay] = tmp;

  draggedDay = null;
  saveState();
  renderWeeklyView();
}

// ---- DAY DETAIL ----

function openDayDetail(weekIndex, dayIndex) {
  const week = state.weeks[weekIndex];
  const day = week.days[dayIndex];
  ui.currentContext = { weekIndex, dayIndex };

  if (day.grannyDay) {
    $("#recipe-detail-title").textContent = "Dinner at Granny's";
    $("#recipe-detail-tags").innerHTML = "";
    $("#recipe-detail-tags").appendChild(
      createElement("span", "chip", "Granny day")
    );
    $("#recipe-detail-url").style.display = "none";
    $("#recipe-detail-image").src = "img/placeholder-recipe.jpg";
    $("#recipe-detail-ingredients").innerHTML = "";
    $("#recipe-detail-instructions").textContent =
      "Relax, Granny's got this one covered. No cooking required!";
  } else {
    const recipe = getRecipeById(day.recipeId);
    if (!recipe) {
      $("#recipe-detail-title").textContent = "No meal selected";
      $("#recipe-detail-tags").innerHTML = "";
      $("#recipe-detail-url").style.display = "none";
      $("#recipe-detail-image").src = "img/placeholder-recipe.jpg";
      $("#recipe-detail-ingredients").innerHTML = "";
      $("#recipe-detail-instructions").textContent =
        "You haven't chosen a meal for this day yet. Use the Recipes tab to add recipes, then tap this day to assign one.";
    } else {
      $("#recipe-detail-title").textContent =
        recipe.title || "Untitled recipe";

      const tagsRow = $("#recipe-detail-tags");
      tagsRow.innerHTML = "";
      if (recipe.disliked) {
        tagsRow.appendChild(createElement("span", "chip", "Disliked"));
      }
      if (recipe.url) {
        tagsRow.appendChild(createElement("span", "chip", "Imported"));
      }

      const link = $("#recipe-detail-url");
      if (recipe.url) {
        link.href = recipe.url;
        link.style.display = "inline-flex";
      } else {
        link.style.display = "none";
      }

      $("#recipe-detail-image").src =
        recipe.imageUrl || "img/placeholder-recipe.jpg";

      const list = $("#recipe-detail-ingredients");
      list.innerHTML = "";
      (recipe.ingredients || []).forEach(item => {
        const li = document.createElement("li");
        if (typeof item === "string") {
          li.textContent = item;
        } else {
          const qty = item.quantity ? `${item.quantity} ` : "";
          const unit = item.unit ? `${item.unit} ` : "";
          li.textContent = `${qty}${unit}${item.name}`;
        }
        list.appendChild(li);
      });

      $("#recipe-detail-instructions").textContent =
        recipe.instructions ||
        "Method not added yet. You can keep the full method in the original BBC Good Food page.";
    }
  }

  $("#recipe-clear-day").onclick = () => {
    if (!ui.currentContext) return;
    clearDay(ui.currentContext.weekIndex, ui.currentContext.dayIndex);
    setActiveView("weekly-view");
  };

  $("#recipe-mark-granny").onclick = () => {
    if (!ui.currentContext) return;
    markGrannyDay(ui.currentContext.weekIndex, ui.currentContext.dayIndex);
    setActiveView("weekly-view");
  };

  setActiveView("recipe-detail-view");
}

// ---- CLEAR / GRANNY DAY ----

function clearDay(weekIndex, dayIndex) {
  const day = state.weeks[weekIndex].days[dayIndex];
  day.recipeId = null;
  day.grannyDay = false;
  saveState();
  renderWeeklyView();
}

function markGrannyDay(weekIndex, dayIndex) {
  const day = state.weeks[weekIndex].days[dayIndex];
  day.grannyDay = true;
  day.recipeId = null;
  saveState();
  renderWeeklyView();
}

function toggleGrannyDay(weekIndex, dayIndex) {
  const day = state.weeks[weekIndex].days[dayIndex];
  day.grannyDay = !day.grannyDay;
  if (day.grannyDay) day.recipeId = null;
  saveState();
  renderWeeklyView();
}

// ---- FOUR WEEK VIEW ----

let draggedWeekIndex = null;

function renderFourWeekView() {
  const container = $("#four-week-container");
  container.innerHTML = "";

  state.weeks.forEach((week, index) => {
    const card = createElement("div", "week-card");
    card.draggable = true;
    card.dataset.weekIndex = index;

    card.addEventListener("dragstart", onWeekDragStart);
    card.addEventListener("dragover", onWeekDragOver);
    card.addEventListener("dragleave", onWeekDragLeave);
    card.addEventListener("drop", onWeekDrop);

    const header = createElement("div", "week-card-header");
    const title = createElement("div", "week-card-title", week.label);
    const summary = createElement("div", "week-card-summary");
    const mealsCount = week.days.filter(d => d.recipeId || d.grannyDay).length;
    summary.textContent = `${mealsCount}/7 days planned`;
    header.appendChild(title);
    header.appendChild(summary);

    const list = createElement("div", "week-card-summary");
    list.textContent = week.days
      .map(d => {
        const recipe = getRecipeById(d.recipeId);
        if (d.grannyDay) return `${d.name}: Granny day`;
        return `${d.name}: ${recipe ? recipe.title : "—"}`;
      })
      .join(" · ");

    card.appendChild(header);
    card.appendChild(list);
    container.appendChild(card);
  });
}

function onWeekDragStart(e) {
  draggedWeekIndex = Number(e.currentTarget.dataset.weekIndex);
  e.dataTransfer.effectAllowed = "move";
}

function onWeekDragOver(e) {
  e.preventDefault();
  e.currentTarget.classList.add("drag-over");
}

function onWeekDragLeave(e) {
  e.currentTarget.classList.remove("drag-over");
}

function onWeekDrop(e) {
  e.preventDefault();
  const target = e.currentTarget;
  target.classList.remove("drag-over");
  if (draggedWeekIndex == null) return;

  const toIndex = Number(target.dataset.weekIndex);
  if (draggedWeekIndex === toIndex) return;

  const [moved] = state.weeks.splice(draggedWeekIndex, 1);
  state.weeks.splice(toIndex, 0, moved);

  draggedWeekIndex = null;
  saveState();
  renderFourWeekView();
  renderWeeklyView();
}

// ---- INGREDIENTS VIEW (AI) ----

async function openIngredientsView() {
  const weekIndex = ui.currentWeekIndex;
  const week = state.weeks[weekIndex];

  $("#ingredients-week-label").textContent = week.label;

  const listContainer = $("#ingredients-list-container");
  listContainer.innerHTML = "";
  const ul = createElement("ul", "ingredients-list");
  ul.appendChild(
    createElement(
      "li",
      null,
      'Click "Generate Smart Ingredients (AI)" to fetch the list.'
    )
  );
  listContainer.appendChild(ul);

  setActiveView("ingredients-view");
}

async function generateSmartIngredientsForWeek() {
  const weekIndex = ui.currentWeekIndex;
  const week = state.weeks[weekIndex];

  const recipes = week.days
    .map(d => getRecipeById(d.recipeId))
    .filter(Boolean)
    .map(r => ({
      title: r.title,
      ingredients: r.ingredients || r.ingredientsRaw || []
    }));

  const listContainer = $("#ingredients-list-container");
  const ul = createElement("ul", "ingredients-list");
  ul.innerHTML = "";
  ul.appendChild(createElement("li", null, "Asking AI…"));
  listContainer.innerHTML = "";
  listContainer.appendChild(ul);

  if (!recipes.length) {
    ul.innerHTML = "";
    ul.appendChild(createElement("li", null, "No recipes for this week yet."));
    return;
  }

  try {
const res = await fetch(`${SUPABASE_FUNCTION_BASE_URL}/import-recipe`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`
  },
  body: JSON.stringify({ urls: [url] })
});
  
    );
    if (!res.ok) throw new Error("AI aggregation failed");
    const aggregated = await res.json();

    listContainer.innerHTML = "";
    const list = createElement("ul", "ingredients-list");

    aggregated.forEach(item => {
      const qty = item.quantity != null ? `${item.quantity} ` : "";
      const unit = item.unit ? `${item.unit} ` : "";
      const li = createElement("li", null, `${qty}${unit}${item.name}`);
      list.appendChild(li);
    });

    listContainer.appendChild(list);
  } catch (e) {
    console.error(e);
    listContainer.innerHTML = "";
    const errList = createElement("ul", "ingredients-list");
    errList.appendChild(
      createElement(
        "li",
        null,
        "AI ingredients generation failed. Please try again later."
      )
    );
    listContainer.appendChild(errList);
  }
}

// ---- RECIPE LIBRARY ----

function renderRecipesLibrary() {
  const container = $("#recipes-library-container");
  container.innerHTML = "";

  const ids = Object.keys(state.recipes);
  if (!ids.length) {
    container.appendChild(
      createElement(
        "p",
        null,
        "No recipes yet. Import some BBC Good Food links on the Import tab."
      )
    );
    return;
  }

  ids.forEach(id => {
    const recipe = state.recipes[id];

    const card = createElement("div", "recipe-card");
    const title = createElement(
      "div",
      "recipe-card-title",
      recipe.title || "Untitled recipe"
    );
    const url = createElement(
      "div",
      "recipe-card-url",
      recipe.url || "No URL saved"
    );
    card.appendChild(title);
    card.appendChild(url);

    const actions = createElement("div", "recipe-card-actions");

    const dislikeBtn = createElement(
      "button",
      "toggle-disliked" + (recipe.disliked ? " toggle-disliked--on" : ""),
      recipe.disliked ? "Disliked" : "Mark disliked"
    );
    dislikeBtn.addEventListener("click", () => {
      recipe.disliked = !recipe.disliked;
      saveState();
      renderRecipesLibrary();
      renderWeeklyView();
    });

    const removeBtn = createElement("button", "remove-recipe-btn", "Remove");
    removeBtn.addEventListener("click", () => {
      if (
        !confirm(
          "Remove this recipe from the library? (Existing planned days keep their label.)"
        )
      )
        return;
      delete state.recipes[id];
      saveState();
      renderRecipesLibrary();
      renderWeeklyView();
    });

    actions.appendChild(dislikeBtn);
    actions.appendChild(removeBtn);
    card.appendChild(actions);

    container.appendChild(card);
  });
}

// ---- IMPORT VIEW (BBC Good Food via edge function) ----

async function handleImport() {
  const textarea = $("#import-urls");
  const messages = $("#import-messages");
  messages.textContent = "";

  const urls = textarea.value
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);

  if (!urls.length) {
    messages.textContent = "No URLs found. Paste at least one BBC Good Food link.";
    return;
  }

  messages.textContent = "Importing recipes…";

  let addedCount = 0;
  for (const url of urls) {
    try {
      const res = await fetch(`${SUPABASE_FUNCTION_BASE_URL}/import-recipe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({ url })
      });
      if (!res.ok) throw new Error("Import failed");

      const data = await res.json();

      // Check for existing by URL
      const exists = Object.values(state.recipes).some(r => r.url === data.url);
      if (exists) continue;

      const id = generateRecipeId();
      state.recipes[id] = {
        id,
        url: data.url,
        title: data.title || "New recipe",
        imageUrl: data.imageUrl || "",
        ingredients: data.ingredients || [],
        ingredientsRaw: data.ingredientsRaw || "",
        instructions: data.instructions || "",
        disliked: false
      };
      addedCount++;
    } catch (e) {
      console.error("Import failed for", url, e);
    }
  }

  saveState();
  renderRecipesLibrary();

  messages.textContent = addedCount
    ? `Imported ${addedCount} recipe${addedCount > 1 ? "s" : ""}.`
    : "No new recipes were imported (they may already exist).";
}

// ---- ASSIGN RECIPE MODAL ----

let modalWeekIndex = null;
let modalDayIndex = null;

function openAssignModal(weekIndex, dayIndex) {
  modalWeekIndex = weekIndex;
  modalDayIndex = dayIndex;

  const backdrop = $("#modal-backdrop");
  const modal = $("#assign-modal");
  const list = $("#assign-modal-list");

  list.innerHTML = "";

  const recipeIds = Object.keys(state.recipes);
  if (!recipeIds.length) {
    list.appendChild(createElement("p", null, "No recipes yet. Import some first."));
  } else {
    recipeIds.forEach(id => {
      const recipe = state.recipes[id];
      const item = createElement("div", "assign-item");
      const title = createElement(
        "div",
        "assign-item-title",
        recipe.title || "Untitled"
      );
      const url = createElement(
        "div",
        "assign-item-url",
        recipe.url || ""
      );
      item.appendChild(title);
      if (recipe.url) item.appendChild(url);

      item.addEventListener("click", () => {
        if (recipe.disliked) {
          const proceed = confirm(
            "Don't you remember you didn't like this! Use it anyway?"
          );
          if (!proceed) return;
        }
        assignRecipeToDay(id, modalWeekIndex, modalDayIndex);
        closeAssignModal();
      });

      list.appendChild(item);
    });
  }

  backdrop.classList.add("show");
  modal.classList.add("show");
}

function closeAssignModal() {
  $("#modal-backdrop").classList.remove("show");
  $("#assign-modal").classList.remove("show");
  modalWeekIndex = null;
  modalDayIndex = null;
}

function assignRecipeToDay(recipeId, weekIndex, dayIndex) {
  const day = state.weeks[weekIndex].days[dayIndex];
  day.recipeId = recipeId;
  day.grannyDay = false;
  saveState();
  renderWeeklyView();
}

// ---- THEME TOGGLE ----

function initTheme() {
  const saved = localStorage.getItem("jardineTheme") || "default";
  if (saved === "pastel") {
    document.body.classList.add("theme-pastel");
  }

  $("#theme-toggle").addEventListener("click", () => {
    document.body.classList.toggle("theme-pastel");
    const mode = document.body.classList.contains("theme-pastel")
      ? "pastel"
      : "default";
    localStorage.setItem("jardineTheme", mode);
  });
}

// ---- NAV / EVENTS ----

function initNav() {
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const viewId = btn.dataset.nav;
      setActiveView(viewId);
      setActiveNavButton(viewId);
      if (viewId === "weekly-view") renderWeeklyView();
      if (viewId === "four-week-view") renderFourWeekView();
      if (viewId === "recipes-library-view") renderRecipesLibrary();
    });
  });

  document.querySelectorAll(".back-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const backView = btn.dataset.back || "weekly-view";
      setActiveView(backView);
      setActiveNavButton(backView);
      if (backView === "weekly-view") renderWeeklyView();
    });
  });

  $("#prev-week").addEventListener("click", () => {
    ui.currentWeekIndex =
      (ui.currentWeekIndex + state.weeks.length - 1) % state.weeks.length;
    renderWeeklyView();
  });

  $("#next-week").addEventListener("click", () => {
    ui.currentWeekIndex =
      (ui.currentWeekIndex + 1) % state.weeks.length;
    renderWeeklyView();
  });

  $("#view-ingredients").addEventListener("click", () =>
    openIngredientsView()
  );
  $("#generate-ingredients-ai").addEventListener("click", () =>
    generateSmartIngredientsForWeek()
  );
  $("#import-btn").addEventListener("click", handleImport);

  $("#modal-backdrop").addEventListener("click", closeAssignModal);
  $("#assign-modal-close").addEventListener("click", closeAssignModal);
}

// ---- SERVICE WORKER (PWA) ----

function initServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(err => {
      console.warn("Service worker registration failed:", err);
    });
  }
}

// ---- INIT ----

document.addEventListener("DOMContentLoaded", async () => {
  initNav();
  initTheme();
  initServiceWorker();

  // Load local quickly, then sync from cloud
  state = loadStateFromLocal();
  renderWeeklyView();

  await syncFromCloud();
  renderWeeklyView();
});
