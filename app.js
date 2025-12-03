// ---- CONFIG ----

// Supabase Edge Functions base URL + anon key (YOUR real values)
const SUPABASE_FUNCTION_BASE_URL =
  "https://tzrmuferszuscavbujbc.supabase.co/functions/v1";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6cm11ZmVyc3p1c2NhdmJ1amJjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ3MTE0MDMsImV4cCI6MjA4MDI4NzQwM30.aRPM29TX1iv2dTRYQNxAGtu_LLAIbfzuKIWRcgNQaRE";

// Local storage key
const STORAGE_KEY = "jardine-meal-planner-state-v1";

// Global state
let state = createInitialState();
const ui = {
  currentWeekIndex: 0,
  currentView: "weekly-view",
};

// Kill old service workers so the app always loads fresh
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((reg) => reg.unregister());
  });
}

// ---- INITIAL STATE ----

function createInitialState() {
  const startOfWeek = getMonday(new Date());
  return {
    weeks: [
      {
        id: `week-${startOfWeek.toISOString().slice(0, 10)}`,
        startDate: startOfWeek.toISOString(),
        days: [0, 1, 2, 3, 4, 5, 6].map((offset) => ({
          date: new Date(startOfWeek.getTime() + offset * 86400000)
            .toISOString()
            .slice(0, 10),
          recipeId: null,
          isGrannyDay: false,
        })),
      },
    ],
    // recipes keyed by recipeId
    recipes: {
      // recipeId: {
      //   id,
      //   url,
      //   title,
      //   imageUrl,
      //   ingredients: [string],
      //   method: [string],  // step-by-step
      //   disliked: false
      // }
    },
  };
}

// ---- LOCAL STORAGE PERSISTENCE ----

function loadStateFromLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.weeks && parsed.recipes) {
      state = parsed;
    }
  } catch (err) {
    console.error("Failed to load local state", err);
  }
}

function saveStateToLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error("Failed to save local state", err);
  }
}

// ---- CLOUD SYNC (Supabase 'state' function) ----

async function syncFromCloud() {
  try {
    const res = await fetch(`${SUPABASE_FUNCTION_BASE_URL}/state`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    if (!res.ok) {
      console.warn("Cloud sync GET failed", await res.text());
      return;
    }

    const remote = await res.json();
    if (remote && remote.weeks && remote.recipes) {
      state = remote;
      saveStateToLocal();
      render();
    }
  } catch (err) {
    console.error("Error syncing from cloud", err);
  }
}

let saveStateTimeout = null;
function scheduleSaveState() {
  saveStateToLocal();
  if (saveStateTimeout) clearTimeout(saveStateTimeout);

  saveStateTimeout = setTimeout(saveStateToCloud, 800);
}

async function saveStateToCloud() {
  try {
    const res = await fetch(`${SUPABASE_FUNCTION_BASE_URL}/state`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(state),
    });

    if (!res.ok) {
      console.warn("Cloud sync POST failed", await res.text());
    }
  } catch (err) {
    console.error("Error saving to cloud", err);
  }
}

// ---- UTILITIES ----

function $(selector) {
  return document.querySelector(selector);
}

function createElement(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined && text !== null) el.textContent = text;
  return el;
}

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay(); // 0 (Sun) - 6 (Sat)
  const diff = (day === 0 ? -6 : 1) - day; // shift Sunday back
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function generateRecipeId() {
  return `recipe-${Math.random().toString(36).slice(2, 10)}`;
}

function getRecipeById(id) {
  return state.recipes[id] || null;
}

function ensureWeeksCoverFour() {
  while (state.weeks.length < 4) {
    const last = state.weeks[state.weeks.length - 1];
    const lastStart = new Date(last.startDate);
    const nextStart = new Date(lastStart.getTime() + 7 * 86400000);
    state.weeks.push({
      id: `week-${nextStart.toISOString().slice(0, 10)}`,
      startDate: nextStart.toISOString(),
      days: [0, 1, 2, 3, 4, 5, 6].map((offset) => ({
        date: new Date(nextStart.getTime() + offset * 86400000)
          .toISOString()
          .slice(0, 10),
        recipeId: null,
        isGrannyDay: false,
      })),
    });
  }
}

// ---- NAVIGATION ----

function setActiveView(viewId) {
  ui.currentView = viewId;

  document.querySelectorAll(".view").forEach((v) => {
    v.classList.toggle("hidden", v.id !== viewId);
  });

  document
    .querySelectorAll('[data-nav-target]')
    .forEach((btn) =>
      btn.classList.toggle(
        "active",
        btn.getAttribute("data-nav-target") === viewId
      )
    );
}

function wireNavigation() {
  document
    .querySelectorAll("[data-nav-target]")
    .forEach((btn) =>
      btn.addEventListener("click", () => {
        const target = btn.getAttribute("data-nav-target");
        setActiveView(target);
        if (target === "weekly-view") {
          renderWeeklyView();
        } else if (target === "four-week-view") {
          renderFourWeekView();
        } else if (target === "recipes-view") {
          renderRecipesLibrary();
        }
      })
    );

  document.querySelectorAll("[data-back]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const backTo = btn.getAttribute("data-back");
      setActiveView(backTo);
      if (backTo === "weekly-view") {
        renderWeeklyView();
      } else if (backTo === "four-week-view") {
        renderFourWeekView();
      } else if (backTo === "recipes-view") {
        renderRecipesLibrary();
      }
    });
  });
}

// ---- WEEKLY VIEW ----

let draggedDay = null;

function renderWeeklyView() {
  ensureWeeksCoverFour();
  const week = state.weeks[ui.currentWeekIndex];

  const container = $("#weekly-grid");
  container.innerHTML = "";

  $("#current-week-label").textContent = new Date(
    week.startDate
  ).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  week.days.forEach((day, dayIndex) => {
    const card = createElement("div", "day-card");
    card.setAttribute("draggable", "true");
    card.dataset.dayIndex = dayIndex;

    const dateLabel = createElement(
      "div",
      "day-date",
      new Date(day.date).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
      })
    );
    card.appendChild(dateLabel);

    if (day.isGrannyDay) {
      const grannyLabel = createElement("div", "granny-label", "Granny day");
      card.appendChild(grannyLabel);
    }

    if (day.recipeId) {
      const recipe = getRecipeById(day.recipeId);
      if (recipe) {
        // Image on the day card
        if (recipe.imageUrl) {
          const img = createElement("img", "day-card-image");
          img.src = recipe.imageUrl;
          img.alt = recipe.title || "Meal image";
          card.appendChild(img);
        }

        const title = createElement("div", "day-title", recipe.title);
        card.appendChild(title);
      } else {
        const missing = createElement(
          "div",
          "day-title muted",
          "Recipe missing"
        );
        card.appendChild(missing);
      }
    } else if (!day.isGrannyDay) {
      const empty = createElement(
        "div",
        "day-title muted",
        "Click to assign"
      );
      card.appendChild(empty);
    }

    // Click: open detail or assign
    card.addEventListener("click", () => {
      openDayDetail(ui.currentWeekIndex, dayIndex);
    });

    // Right-click to toggle granny day
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      day.isGrannyDay = !day.isGrannyDay;
      if (day.isGrannyDay) {
        day.recipeId = null;
      }
      scheduleSaveState();
      renderWeeklyView();
    });

    // Drag & drop
    card.addEventListener("dragstart", (e) => {
      draggedDay = { weekIndex: ui.currentWeekIndex, dayIndex };
      e.dataTransfer.effectAllowed = "move";
    });

    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      card.classList.add("drag-over");
    });

    card.addEventListener("dragleave", () => {
      card.classList.remove("drag-over");
    });

    card.addEventListener("drop", (e) => {
      e.preventDefault();
      card.classList.remove("drag-over");
      if (!draggedDay) return;

      const fromIndex = draggedDay.dayIndex;
      const toIndex = dayIndex;
      if (fromIndex === toIndex) return;

      const days = week.days;
      const tmp = days[fromIndex];
      days[fromIndex] = days[toIndex];
      days[toIndex] = tmp;

      draggedDay = null;
      scheduleSaveState();
      renderWeeklyView();
    });

    container.appendChild(card);
  });
}

function wireWeeklyViewControls() {
  $("#prev-week-btn").addEventListener("click", () => {
    ui.currentWeekIndex = Math.max(0, ui.currentWeekIndex - 1);
    renderWeeklyView();
  });

  $("#next-week-btn").addEventListener("click", () => {
    ensureWeeksCoverFour();
    ui.currentWeekIndex = Math.min(state.weeks.length - 1, ui.currentWeekIndex + 1);
    renderWeeklyView();
  });

  $("#ingredients-btn").addEventListener("click", () => {
    openIngredientsView(ui.currentWeekIndex);
  });
}

// ---- FOUR-WEEK VIEW ----

let draggedWeekIndex = null;

function renderFourWeekView() {
  ensureWeeksCoverFour();
  const container = $("#four-week-grid");
  container.innerHTML = "";

  state.weeks.forEach((week, index) => {
    const card = createElement("div", "week-card");
    card.setAttribute("draggable", "true");
    card.dataset.weekIndex = index;

    const start = new Date(week.startDate);
    const end = new Date(start.getTime() + 6 * 86400000);

    const header = createElement(
      "div",
      "week-card-header",
      `${start.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      })} - ${end.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      })}`
    );
    card.appendChild(header);

    const list = createElement("ul", "week-card-list");
    week.days.forEach((day) => {
      const li = document.createElement("li");
      const dateStr = new Date(day.date).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
      });

      if (day.isGrannyDay) {
        li.textContent = `${dateStr}: Granny day`;
      } else if (day.recipeId) {
        const recipe = getRecipeById(day.recipeId);
        li.textContent = recipe
          ? `${dateStr}: ${recipe.title}`
          : `${dateStr}: [missing recipe]`;
      } else {
        li.textContent = `${dateStr}: [empty]`;
      }

      list.appendChild(li);
    });
    card.appendChild(list);

    card.addEventListener("click", () => {
      ui.currentWeekIndex = index;
      setActiveView("weekly-view");
      renderWeeklyView();
    });

    card.addEventListener("dragstart", (e) => {
      draggedWeekIndex = index;
      e.dataTransfer.effectAllowed = "move";
    });

    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      card.classList.add("drag-over");
    });

    card.addEventListener("dragleave", () => {
      card.classList.remove("drag-over");
    });

    card.addEventListener("drop", (e) => {
      e.preventDefault();
      card.classList.remove("drag-over");
      if (draggedWeekIndex === null) return;
      if (draggedWeekIndex === index) return;

      const temp = state.weeks[draggedWeekIndex];
      state.weeks[draggedWeekIndex] = state.weeks[index];
      state.weeks[index] = temp;

      draggedWeekIndex = null;
      scheduleSaveState();
      renderFourWeekView();
    });

    container.appendChild(card);
  });
}

// ---- DAY DETAIL / RECIPE DETAIL ----

function openDayDetail(weekIndex, dayIndex) {
  const week = state.weeks[weekIndex];
  const day = week.days[dayIndex];

  $("#day-detail-date").textContent = new Date(day.date).toLocaleDateString(
    "en-GB",
    { weekday: "long", day: "numeric", month: "long" }
  );

  const grannyToggle = $("#day-detail-granny-toggle");
  grannyToggle.checked = day.isGrannyDay;
  grannyToggle.onchange = () => {
    day.isGrannyDay = grannyToggle.checked;
    if (day.isGrannyDay) {
      day.recipeId = null;
    }
    scheduleSaveState();
    renderWeeklyView();
  };

  const container = $("#day-detail-content");
  container.innerHTML = "";

  if (day.isGrannyDay) {
    const msg = createElement("p", "muted", "Granny is providing dinner.");
    container.appendChild(msg);
  } else if (day.recipeId) {
    const recipe = getRecipeById(day.recipeId);
    if (recipe) {
      renderRecipeDetail(recipe);
    } else {
      const missing = createElement(
        "p",
        "muted",
        "Recipe not found. Please reassign."
      );
      container.appendChild(missing);
    }
  } else {
    const msg = createElement(
      "p",
      "muted",
      "No recipe assigned. Use the button below to choose one."
    );
    container.appendChild(msg);
  }

  const assignBtn = $("#day-detail-assign-btn");
  assignBtn.onclick = () => openAssignModal(weekIndex, dayIndex);

  setActiveView("day-detail-view");
}

// Used by weekly view AND by library “View” button
function renderRecipeDetail(recipe) {
  const container = $("#day-detail-content");
  container.innerHTML = "";

  const title = createElement("h2", "recipe-title", recipe.title);
  container.appendChild(title);

  if (recipe.imageUrl) {
    const img = createElement("img", "recipe-detail-image");
    img.src = recipe.imageUrl;
    img.alt = recipe.title || "Meal photo";
    container.appendChild(img);
  }

  // Ingredients
  const ingHeading = createElement("h3", null, "Ingredients");
  container.appendChild(ingHeading);

  const ingredientsBox = createElement("div", "recipe-ingredients");
  const ingredientsList = Array.isArray(recipe.ingredients)
    ? recipe.ingredients
    : [];

  if (ingredientsList.length) {
    const ul = document.createElement("ul");
    ingredientsList.forEach((line) => {
      const li = document.createElement("li");
      li.textContent = line;
      ul.appendChild(li);
    });
    ingredientsBox.appendChild(ul);
  } else {
    ingredientsBox.textContent = "Ingredients not available for this recipe.";
  }
  container.appendChild(ingredientsBox);

  // Method (as steps)
  const methodHeading = createElement("h3", null, "Method");
  container.appendChild(methodHeading);

  const methodBox = createElement("div", "recipe-method");
  const steps = Array.isArray(recipe.method)
    ? recipe.method
    : recipe.instructions
    ? [recipe.instructions]
    : [];

  if (steps.length) {
    const ol = document.createElement("ol");
    steps.forEach((step) => {
      if (!step) return;
      const li = document.createElement("li");
      li.textContent = step.replace(/\s+/g, " ").trim();
      ol.appendChild(li);
    });
    methodBox.appendChild(ol);
  } else {
    methodBox.textContent = "Method not available for this recipe.";
  }
  container.appendChild(methodBox);
}

// ---- ASSIGN MODAL ----

function openAssignModal(weekIndex, dayIndex) {
  const modal = $("#assign-modal");
  const list = $("#assign-modal-list");
  list.innerHTML = "";

  const entries = Object.values(state.recipes);
  if (!entries.length) {
    const li = createElement(
      "li",
      "muted",
      "No recipes yet. Import some from BBC Good Food first."
    );
    list.appendChild(li);
  } else {
    entries.forEach((recipe) => {
      const li = createElement("li", "assign-item");
      const title = createElement("span", "assign-title", recipe.title);
      if (recipe.disliked) {
        title.classList.add("disliked");
      }
      li.appendChild(title);

      li.addEventListener("click", () => {
        const week = state.weeks[weekIndex];
        week.days[dayIndex].recipeId = recipe.id;
        week.days[dayIndex].isGrannyDay = false;
        closeAssignModal();
        scheduleSaveState();
        renderWeeklyView();
        openDayDetail(weekIndex, dayIndex);
      });

      list.appendChild(li);
    });
  }

  modal.classList.add("open");
}

function closeAssignModal() {
  $("#assign-modal").classList.remove("open");
}

// ---- RECIPES LIBRARY ----

function renderRecipesLibrary() {
  const container = $("#recipes-list");
  container.innerHTML = "";

  const recipes = Object.values(state.recipes);
  if (!recipes.length) {
    container.appendChild(
      createElement(
        "p",
        "muted",
        "No recipes yet. Paste some BBC Good Food URLs into the Import section."
      )
    );
    return;
  }

  recipes.sort((a, b) => a.title.localeCompare(b.title));

  recipes.forEach((recipe) => {
    const card = createElement("div", "recipe-card");

    if (recipe.imageUrl) {
      const img = createElement("img", "recipe-card-image");
      img.src = recipe.imageUrl;
      img.alt = recipe.title || "Meal photo";
      card.appendChild(img);
    }

    const title = createElement("h3", "recipe-card-title", recipe.title);
    if (recipe.disliked) title.classList.add("disliked");
    card.appendChild(title);

    const actions = createElement("div", "recipe-card-actions");

    // View button – opens recipe detail view
    const viewBtn = createElement("button", "btn-secondary", "View");
    viewBtn.addEventListener("click", () => {
      renderRecipeDetail(recipe);
      setActiveView("day-detail-view");
    });
    actions.appendChild(viewBtn);

    const dislikeBtn = createElement(
      "button",
      "btn-secondary",
      recipe.disliked ? "Unmark dislike" : "Mark disliked"
    );
    dislikeBtn.addEventListener("click", () => {
      recipe.disliked = !recipe.disliked;
      scheduleSaveState();
      renderRecipesLibrary();
    });
    actions.appendChild(dislikeBtn);

    const removeBtn = createElement("button", "btn-danger", "Remove");
    removeBtn.addEventListener("click", () => {
      if (!confirm("Remove this recipe from your library?")) return;

      // Clear it from any days
      state.weeks.forEach((week) => {
        week.days.forEach((day) => {
          if (day.recipeId === recipe.id) {
            day.recipeId = null;
          }
        });
      });

      delete state.recipes[recipe.id];
      scheduleSaveState();
      renderRecipesLibrary();
      renderWeeklyView();
    });
    actions.appendChild(removeBtn);

    card.appendChild(actions);
    container.appendChild(card);
  });
}

// ---- IMPORT VIEW (BBC Good Food) ----

async function handleImport() {
  const textarea = $("#import-urls");
  const raw = textarea.value.trim();
  if (!raw) {
    alert("Paste at least one BBC Good Food URL.");
    return;
  }

  const urls = raw
    .split(/\s+/)
    .map((u) => u.trim())
    .filter(Boolean);

  if (!urls.length) {
    alert("No valid URLs found.");
    return;
  }

  $("#import-status").textContent = "Importing...";
  $("#import-status").classList.remove("error");
  $("#import-status").classList.remove("success");

  try {
    for (const url of urls) {
      const res = await fetch(
        `${SUPABASE_FUNCTION_BASE_URL}/import-recipe`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ url }),
        }
      );

      if (!res.ok) {
        console.error("Import failed", await res.text());
        throw new Error("Import function error");
      }

      const data = await res.json();

      // ---- Parse BBC Good Food JSON ----
      // Prefer schema.recipeIngredient + schema.recipeInstructions
      const schema = data.schema || {};
      const schemaIngredients = Array.isArray(schema.recipeIngredient)
        ? schema.recipeIngredient
        : [];
      const schemaInstructions = Array.isArray(schema.recipeInstructions)
        ? schema.recipeInstructions
        : [];

      const ingredients = schemaIngredients.length
        ? schemaIngredients
        : extractIngredientsFromLegacy(data);

      const method = schemaInstructions.length
        ? schemaInstructions
            .map((step) =>
              typeof step === "string"
                ? step
                : step?.text || ""
            )
            .filter(Boolean)
        : extractMethodFromLegacy(data);

      const title =
        schema.name ||
        data.title ||
        data.siteTitle ||
        "Untitled recipe";

      const imageUrl =
        (Array.isArray(schema.image) && schema.image[0]?.url) ||
        data.image?.url ||
        data.image?.[0]?.url ||
        null;

      const sourceUrl =
        data.canonicalUrl || data.pageUrl || url;

      // ---- Store in state.recipes ----
      // Use canonical URL as id if possible, else random
      const id =
        sourceUrl && sourceUrl.startsWith("http")
          ? sourceUrl
          : generateRecipeId();

      if (!state.recipes[id]) {
        state.recipes[id] = {
          id,
          url: sourceUrl,
          title,
          imageUrl,
          ingredients,
          method,
          disliked: false,
        };
      }
    }

    scheduleSaveState();
    renderRecipesLibrary();
    renderWeeklyView();

    $("#import-status").textContent =
      "Imported successfully. You can now assign these recipes.";
    $("#import-status").classList.add("success");
  } catch (err) {
    console.error(err);
    $("#import-status").textContent =
      "Import failed. Check the console for details.";
    $("#import-status").classList.add("error");
  }
}

function extractIngredientsFromLegacy(data) {
  // Older structure: data.ingredients = [{ heading, ingredients: [{ ingredientText, quantityText, note }]}]
  if (!data.ingredients || !Array.isArray(data.ingredients)) return [];
  const lines = [];
  data.ingredients.forEach((group) => {
    if (!Array.isArray(group.ingredients)) return;
    group.ingredients.forEach((ing) => {
      const qty = ing.quantityText || "";
      const name = ing.ingredientText || "";
      const note = ing.note || "";
      const parts = [qty, name, note].map((p) => p.trim()).filter(Boolean);
      if (parts.length) {
        lines.push(parts.join(" "));
      }
    });
  });
  return lines;
}

function extractMethodFromLegacy(data) {
  // Older structure: data.methodSteps = [{ content: [{ data: { value: "<p>...</p>"}}]}]
  if (!data.methodSteps || !Array.isArray(data.methodSteps)) return [];
  const steps = [];
  data.methodSteps.forEach((step) => {
    if (!Array.isArray(step.content)) return;
    step.content.forEach((chunk) => {
      const htmlVal = chunk?.data?.value || "";
      if (!htmlVal) return;
      const text = htmlVal
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) steps.push(text);
    });
  });
  return steps;
}

// ---- INGREDIENTS VIEW (AI AGGREGATOR) ----

async function openIngredientsView(weekIndex) {
  const week = state.weeks[weekIndex];

  const container = $("#ingredients-list");
  const status = $("#ingredients-status");

  container.innerHTML = "";
  status.textContent = "Generating ingredients list…";
  status.classList.remove("error");
  status.classList.remove("success");

  // Collect recipes for that week
  const recipesForWeek = [];
  week.days.forEach((day) => {
    if (day.recipeId && !day.isGrannyDay) {
      const recipe = getRecipeById(day.recipeId);
      if (recipe) recipesForWeek.push(recipe);
    }
  });

  if (!recipesForWeek.length) {
    status.textContent =
      "No recipes assigned for this week.";
    return;
  }

  try {
    const payload = {
      recipes: recipesForWeek.map((r) => ({
        title: r.title,
        ingredients: r.ingredients || [],
      })),
    };

    const res = await fetch(
      `${SUPABASE_FUNCTION_BASE_URL}/aggregate-ingredients`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify(payload),
      }
    );

    if (!res.ok) {
      console.error(await res.text());
      throw new Error("AI function error");
    }

    const data = await res.json();
    // Expecting: { items: [{ name, quantity, unit, notes }], rawText }
    container.innerHTML = "";

    if (Array.isArray(data.items) && data.items.length) {
      const list = document.createElement("ul");
      data.items.forEach((item) => {
        const li = document.createElement("li");
        const qtyPart =
          item.quantity || item.unit
            ? `${item.quantity || ""} ${item.unit || ""} `
            : "";
        const notePart = item.notes ? ` (${item.notes})` : "";
        li.textContent = `${qtyPart}${item.name}${notePart}`.trim();
        list.appendChild(li);
      });
      container.appendChild(list);
    } else if (data.rawText) {
      const pre = document.createElement("pre");
      pre.textContent = data.rawText;
      container.appendChild(pre);
    } else {
      container.textContent =
        "No ingredients returned from AI.";
    }

    status.textContent =
      "Ingredients list generated (AI normalised quantities).";
    status.classList.add("success");
  } catch (err) {
    console.error(err);
    status.textContent =
      "Failed to generate ingredients list. Check console.";
    status.classList.add("error");
  }

  setActiveView("ingredients-view");
}

// ---- IMPORT VIEW WIRING ----

function wireImportView() {
  $("#import-btn").addEventListener("click", () => {
    handleImport();
  });
}

// ---- MODAL WIRING ----

function wireModals() {
  $("#assign-modal-close").addEventListener("click", closeAssignModal);

  $("#assign-modal").addEventListener("click", (e) => {
    if (e.target.id === "assign-modal") {
      closeAssignModal();
    }
  });
}

// ---- INITIALISATION ----

function render() {
  if (ui.currentView === "weekly-view") {
    renderWeeklyView();
  } else if (ui.currentView === "four-week-view") {
    renderFourWeekView();
  } else if (ui.currentView === "recipes-view") {
    renderRecipesLibrary();
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  loadStateFromLocal();
  wireNavigation();
  wireWeeklyViewControls();
  wireImportView();
  wireModals();

  setActiveView("weekly-view");
  renderWeeklyView();

  // Try to sync from cloud but don't block UI
  syncFromCloud();
});
