// app.js – clean rebuild for Jardine Meal Planner
// ----------------------------------------------
// This file is vanilla JS, no bundler, no external libraries needed.

// ==== CONFIG ==========================================================

// IMPORTANT: put your real anon key in this constant *locally*.
// Don't commit secrets in public repos if you can avoid it.
const SUPABASE_URL = "https://tzrmuferszuscavbujbc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6cm11ZmVyc3p1c2NhdmJ1amJjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ3MTE0MDMsImV4cCI6MjA4MDI4NzQwM30.aRPM29TX1iv2dTRYQNxAGtu_LLAIbfzuKIWRcgNQaRE"; // <- paste here BEFORE committing if you're happy with it being public

// Table + row key
const STATE_TABLE = "mealplanner_state";
const STATE_ROW_ID = "global";

// Edge Functions (already deployed in your Supabase project)
const FUNCTION_BASE = `${SUPABASE_URL}/functions/v1`;
const IMPORT_FUNCTION_URL = `${FUNCTION_BASE}/import-recipe`;
const AGGREGATE_FUNCTION_URL = `${FUNCTION_BASE}/aggregate-ingredients`;

// Basic empty state
const EMPTY_STATE = {
  currentWeekIndex: 0,
  weeks: [],          // filled in on first load
  recipes: {}         // id -> recipe
};

// ==== SMALL UTILITIES =================================================

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function safeAddListener(el, event, handler) {
  if (el) el.addEventListener(event, handler);
}

function createEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

// Simple ID generator for recipes
function generateIdFromUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  } catch {
    return "recipe-" + Math.random().toString(36).slice(2);
  }
}

// Local cache so we don't hammer Supabase unnecessarily
let appState = structuredClone(EMPTY_STATE);
let stateLoaded = false;
let isSaving = false;

// ==== SUPABASE HELPERS ===============================================

async function supabaseRequest(path, options = {}) {
  const url = `${SUPABASE_URL}${path}`;
  const headers = options.headers || {};
  headers["apikey"] = SUPABASE_ANON_KEY;
  headers["Authorization"] = `Bearer ${SUPABASE_ANON_KEY}`;
  if (!headers["Content-Type"] && options.body) {
    headers["Content-Type"] = "application/json";
  }

  const resp = await fetch(url, { ...options, headers });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    console.error("Supabase request failed", resp.status, text);
    throw new Error(`Supabase error ${resp.status}`);
  }
  if (resp.status === 204) return null;
  return resp.json();
}

// Load global state row (or create it)
async function loadStateFromSupabase() {
  try {
    const data = await supabaseRequest(
      `/rest/v1/${STATE_TABLE}?id=eq.${encodeURIComponent(
        STATE_ROW_ID
      )}&select=state_json`
    );

    if (Array.isArray(data) && data.length && data[0].state_json) {
      appState = {
        ...structuredClone(EMPTY_STATE),
        ...data[0].state_json
      };
      console.log("Loaded state from Supabase", appState);
    } else {
      console.log("No state row found – creating default");
      appState = structuredClone(EMPTY_STATE);
      if (!appState.weeks.length) initialiseWeeks();
      await saveStateToSupabase();
    }
  } catch (err) {
    console.warn("Falling back to localStorage, Supabase load failed:", err);
    loadStateFromLocal();
  } finally {
    if (!appState.weeks.length) initialiseWeeks();
    stateLoaded = true;
  }
}

async function saveStateToSupabase() {
  if (isSaving) return;
  isSaving = true;
  try {
    const payload = [
      {
        id: STATE_ROW_ID,
        state_json: appState
      }
    ];
    await supabaseRequest(`/rest/v1/${STATE_TABLE}`, {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates"
      },
      body: JSON.stringify(payload)
    });
    console.log("State saved to Supabase");
  } catch (err) {
    console.error("Failed to save to Supabase:", err);
  } finally {
    isSaving = false;
  }
}

function loadStateFromLocal() {
  try {
    const raw = localStorage.getItem("jardine-meal-state");
    if (raw) {
      const parsed = JSON.parse(raw);
      appState = {
        ...structuredClone(EMPTY_STATE),
        ...parsed
      };
      console.log("Loaded state from localStorage");
    } else {
      appState = structuredClone(EMPTY_STATE);
      initialiseWeeks();
    }
  } catch {
    appState = structuredClone(EMPTY_STATE);
    initialiseWeeks();
  }
}

function saveStateToLocal() {
  try {
    localStorage.setItem("jardine-meal-state", JSON.stringify(appState));
  } catch (e) {
    console.warn("Failed to save to localStorage:", e);
  }
}

function persistState() {
  saveStateToLocal();
  saveStateToSupabase().catch(() => {});
}

// ==== INITIAL WEEK STRUCTURE ==========================================

function initialiseWeeks() {
  if (appState.weeks && appState.weeks.length) return;
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  appState.weeks = Array.from({ length: 4 }, (_, w) => ({
    name: `Week ${w + 1}`,
    days: dayNames.map((d) => ({
      label: d,
      recipeId: null,
      isGrannyDay: false,
      noMeal: false
    }))
  }));
}

// ==== RENDERING – VIEWS ===============================================

function setActiveView(viewId) {
  $$(".view").forEach((section) => {
    if (section.id === viewId) {
      section.classList.add("view--active");
    } else {
      section.classList.remove("view--active");
    }
  });
}

function renderNavState() {
  const thisWeekLink = $("#nav-this-week");
  const fourWeekLink = $("#nav-four-week");
  const recipesLink = $("#nav-recipes");
  const importLink = $("#nav-import");

  [thisWeekLink, fourWeekLink, recipesLink, importLink].forEach((link) => {
    if (!link) return;
    link.classList.remove("nav-link--active");
  });

  const activeView = $(".view.view--active");
  if (!activeView) return;
  const id = activeView.id;
  const map = {
    "view-this-week": thisWeekLink,
    "view-four-week": fourWeekLink,
    "view-recipes": recipesLink,
    "view-import": importLink
  };
  if (map[id]) map[id].classList.add("nav-link--active");
}

// ---- This Week -------------------------------------------------------

function getCurrentWeek() {
  return appState.weeks[appState.currentWeekIndex] || appState.weeks[0];
}

function ensureWeekGridContainer() {
  let grid = $("#week-grid");
  if (!grid) {
    const heading = $("#this-week-heading") || $("h2");
    grid = createEl("div", "week-grid");
    grid.id = "week-grid";
    if (heading && heading.parentNode) {
      heading.parentNode.insertBefore(grid, heading.nextSibling);
    } else {
      const view = $("#view-this-week") || $("main") || document.body;
      view.appendChild(grid);
    }
  }
  return grid;
}

function renderWeekView() {
  if (!stateLoaded) return;

  const week = getCurrentWeek();
  const weekLabel = $("#week-label");
  if (weekLabel) weekLabel.textContent = week?.name || `Week ${appState.currentWeekIndex + 1}`;

  const grid = ensureWeekGridContainer();
  grid.innerHTML = "";

  week.days.forEach((day, idx) => {
    const card = createEl("button", "day-card");

    const badgeRow = createEl("div", "day-card__badges");
    const label = createEl("div", "day-card__label", day.label);
    badgeRow.appendChild(label);

    if (day.isGrannyDay) {
      const g = createEl("span", "badge badge--granny", "👵 Granny");
      badgeRow.appendChild(g);
    }
    if (day.noMeal) {
      const n = createEl("span", "badge badge--none", "✕ No meal");
      badgeRow.appendChild(n);
    }

    card.appendChild(badgeRow);

    const title = createEl(
      "div",
      "day-card__title",
      day.recipeId && appState.recipes[day.recipeId]
        ? appState.recipes[day.recipeId].title
        : "Tap to choose recipe…"
    );
    card.appendChild(title);

    const imgWrap = createEl("div", "day-card__image");
    if (day.recipeId && appState.recipes[day.recipeId]?.image) {
      const img = document.createElement("img");
      img.src = appState.recipes[day.recipeId].image;
      img.alt = appState.recipes[day.recipeId].title;
      img.loading = "lazy";
      imgWrap.appendChild(img);
    } else {
      imgWrap.classList.add("day-card__image--placeholder");
    }
    card.appendChild(imgWrap);

    card.addEventListener("click", () => openDayPicker(idx));
    grid.appendChild(card);
  });
}

// A very simple “picker” – uses prompt for now
function openDayPicker(dayIndex) {
  const week = getCurrentWeek();
  const day = week.days[dayIndex];

  const recipeTitles = Object.values(appState.recipes).map(
    (r, i) => `${i + 1}. ${r.title}`
  );

  let message = `Choose an option for ${day.label}:\n\n`;
  if (recipeTitles.length) {
    message += recipeTitles.join("\n") + "\n\n";
  } else {
    message += "(No recipes in your library yet – use Import first.)\n\n";
  }
  message += "N = No meal\nG = Granny day\nC = Clear\nOr enter recipe number.";

  const answer = prompt(message);
  if (answer == null) return;

  const trimmed = answer.trim().toUpperCase();
  if (trimmed === "N") {
    day.noMeal = true;
    day.isGrannyDay = false;
    day.recipeId = null;
  } else if (trimmed === "G") {
    day.isGrannyDay = true;
    day.noMeal = false;
    day.recipeId = null;
  } else if (trimmed === "C") {
    day.isGrannyDay = false;
    day.noMeal = false;
    day.recipeId = null;
  } else {
    const idx = parseInt(trimmed, 10);
    const recipesArr = Object.values(appState.recipes);
    if (!isNaN(idx) && idx >= 1 && idx <= recipesArr.length) {
      const chosen = recipesArr[idx - 1];
      day.recipeId = chosen.id;
      day.isGrannyDay = false;
      day.noMeal = false;
    } else {
      alert("I didn’t understand that – please try again.");
      return;
    }
  }

  persistState();
  renderWeekView();
}

// ---- 4-week overview -------------------------------------------------

function ensureFourWeekGrid() {
  let grid = $("#four-week-grid");
  if (!grid) {
    const view = $("#view-four-week") || $("main") || document.body;
    grid = createEl("div", "four-week-grid");
    grid.id = "four-week-grid";
    view.appendChild(grid);
  }
  return grid;
}

function renderFourWeekView() {
  if (!stateLoaded) return;
  const grid = ensureFourWeekGrid();
  grid.innerHTML = "";

  appState.weeks.forEach((week, wIndex) => {
    const card = createEl("div", "week-summary-card");
    const heading = createEl("div", "week-summary-card__heading", week.name);
    card.appendChild(heading);

    const list = createEl("ul", "week-summary-card__list");
    week.days.forEach((day) => {
      const li = createEl("li");
      let text = `${day.label}: `;
      if (day.noMeal) text += "✕ No meal";
      else if (day.isGrannyDay) text += "👵 Granny day";
      else if (day.recipeId && appState.recipes[day.recipeId]) {
        text += appState.recipes[day.recipeId].title;
      } else text += "–";
      li.textContent = text;
      list.appendChild(li);
    });

    card.appendChild(list);
    card.addEventListener("click", () => {
      appState.currentWeekIndex = wIndex;
      setActiveView("view-this-week");
      renderWeekView();
      renderNavState();
    });

    grid.appendChild(card);
  });
}

// ---- Recipes library -------------------------------------------------

function ensureRecipesList() {
  let list = $("#recipes-list");
  if (!list) {
    const view = $("#view-recipes") || $("main") || document.body;
    list = createEl("div", "recipes-list");
    list.id = "recipes-list";
    view.appendChild(list);
  }
  return list;
}

function renderRecipesView() {
  if (!stateLoaded) return;

  const list = ensureRecipesList();
  list.innerHTML = "";

  const recipeValues = Object.values(appState.recipes);
  if (!recipeValues.length) {
    list.appendChild(
      createEl(
        "p",
        "muted",
        "No recipes yet. Use the Import tab to add recipes from BBC Good Food."
      )
    );
    return;
  }

  recipeValues.forEach((recipe) => {
    const card = createEl("div", "recipe-card");

    if (recipe.image) {
      const img = document.createElement("img");
      img.src = recipe.image;
      img.alt = recipe.title;
      img.loading = "lazy";
      img.className = "recipe-card__image";
      card.appendChild(img);
    }

    const body = createEl("div", "recipe-card__body");
    const title = createEl("h3", "recipe-card__title", recipe.title);
    body.appendChild(title);

    const tags = [];
    if (recipe.servings) tags.push(`${recipe.servings} servings`);
    if (recipe.time) tags.push(recipe.time);
    if (recipe.isGlutenFree) tags.push("Gluten-free");
    if (recipe.isVegetarian) tags.push("Vegetarian");
    if (tags.length) {
      const meta = createEl("div", "recipe-card__meta", tags.join(" · "));
      body.appendChild(meta);
    }

    const footer = createEl("div", "recipe-card__footer");
    const openBtn = createEl("button", "btn btn--ghost", "View");
    openBtn.addEventListener("click", () => openRecipeDetail(recipe.id));
    footer.appendChild(openBtn);

    if (recipe.url) {
      const link = createEl("a", "btn btn--link", "View original");
      link.href = recipe.url;
      link.target = "_blank";
      footer.appendChild(link);
    }

    body.appendChild(footer);
    card.appendChild(body);
    list.appendChild(card);
  });
}

// ---- Recipe detail ---------------------------------------------------

function openRecipeDetail(recipeId) {
  const recipe = appState.recipes[recipeId];
  if (!recipe) return;

  const titleEl = $("#recipe-detail-title");
  const imgEl = $("#recipe-detail-image");
  const ingEl = $("#recipe-detail-ingredients");
  const methodEl = $("#recipe-detail-method");

  if (titleEl) titleEl.textContent = recipe.title || "Recipe";

  if (imgEl) {
    if (recipe.image) {
      imgEl.src = recipe.image;
      imgEl.alt = recipe.title || "";
      imgEl.classList.remove("recipe-detail__image--placeholder");
    } else {
      imgEl.src = "";
      imgEl.alt = "";
      imgEl.classList.add("recipe-detail__image--placeholder");
    }
  }

  if (ingEl) {
    ingEl.innerHTML = "";
    if (Array.isArray(recipe.ingredients) && recipe.ingredients.length) {
      recipe.ingredients.forEach((section) => {
        if (section.heading) {
          const h = createEl("h4", null, section.heading);
          ingEl.appendChild(h);
        }
        const ul = createEl("ul");
        section.items.forEach((item) => {
          ul.appendChild(createEl("li", null, item));
        });
        ingEl.appendChild(ul);
      });
    } else {
      ingEl.appendChild(createEl("p", "muted", "No ingredients parsed."));
    }
  }

  if (methodEl) {
    methodEl.innerHTML = "";
    if (Array.isArray(recipe.method) && recipe.method.length) {
      const ol = createEl("ol");
      recipe.method.forEach((step) => {
        ol.appendChild(createEl("li", null, step));
      });
      methodEl.appendChild(ol);
    } else if (recipe.methodText) {
      methodEl.textContent = recipe.methodText;
    } else {
      methodEl.appendChild(createEl("p", "muted", "No method parsed."));
    }
  }

  setActiveView("view-recipe-detail");
  renderNavState();
}

// ==== IMPORT RECIPES ==================================================

async function handleImportSubmit() {
  const textarea = $("#import-textarea");
  if (!textarea) return;

  const raw = textarea.value.trim();
  if (!raw) {
    alert("Paste one or more BBC Good Food URLs first.");
    return;
  }
  const urls = raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!urls.length) {
    alert("No valid URLs found.");
    return;
  }

  const importBtn = $("#import-btn");
  if (importBtn) {
    importBtn.disabled = true;
    importBtn.textContent = "Importing…";
  }

  try {
    const resp = await fetch(IMPORT_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ urls })
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("Import function error:", resp.status, text);
      alert("Import failed – please check the console in DevTools.");
      return;
    }

    const payload = await resp.json();
    console.log("Import payload:", payload);

    // EXPECTED SHAPE (adjust if your function is different):
    // { recipes: [ { title, url, image, ingredients: [ {heading, items:[] } ], method: [step1,...], servings, time, isGlutenFree, isVegetarian } ] }
    const newRecipes = Array.isArray(payload.recipes) ? payload.recipes : [];
    if (!newRecipes.length) {
      alert("No new recipes were imported (they may already exist).");
      return;
    }

    let addedCount = 0;
    newRecipes.forEach((r) => {
      const id = r.id || generateIdFromUrl(r.url || r.title || "");
      if (!appState.recipes[id]) {
        appState.recipes[id] = {
          id,
          title: r.title || "Untitled recipe",
          url: r.url,
          image: r.image,
          ingredients: r.ingredients || [],
          method: r.method || r.methodSteps || [],
          methodText: r.methodText || "",
          servings: r.servings,
          time: r.time,
          isGlutenFree: !!r.isGlutenFree,
          isVegetarian: !!r.isVegetarian
        };
        addedCount++;
      }
    });

    persistState();
    renderRecipesView();

    alert(`Imported ${addedCount} new recipe${addedCount === 1 ? "" : "s"}.`);
    textarea.value = "";
  } catch (err) {
    console.error("Import error:", err);
    alert("Import failed – see console for details.");
  } finally {
    if (importBtn) {
      importBtn.disabled = false;
      importBtn.textContent = "Import Recipes";
    }
  }
}

// ==== WEEKLY INGREDIENTS (AI) ========================================

async function handleWeeklyIngredients() {
  if (!stateLoaded) return;
  const btn = $("#ingredients-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Thinking…";
  }

  try {
    const week = getCurrentWeek();
    const body = {
      state: appState,
      weekIndex: appState.currentWeekIndex
    };

    const resp = await fetch(AGGREGATE_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("aggregate-ingredients error:", resp.status, text);
      alert("AI ingredients failed – check console.");
      return;
    }

    const payload = await resp.json();
    console.log("AI ingredients payload:", payload);

    // EXPECTED SHAPE (adjust once we see real output):
    // { lines: ["2 x chicken breasts", "400g chopped tomatoes", ...] }
    const lines = Array.isArray(payload.lines)
      ? payload.lines
      : payload.ingredients || [];

    if (!lines.length) {
      alert("No ingredients returned.");
      return;
    }

    alert(`Ingredients for ${week.name}:\n\n${lines.join("\n")}`);
  } catch (err) {
    console.error("Weekly ingredients error:", err);
    alert("AI ingredients failed – see console for details.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Weekly Ingredients";
    }
  }
}

// ==== WIRING & STARTUP ================================================

function wireNavigation() {
  safeAddListener($("#nav-this-week"), "click", (e) => {
    e.preventDefault();
    setActiveView("view-this-week");
    renderWeekView();
    renderNavState();
  });

  safeAddListener($("#nav-four-week"), "click", (e) => {
    e.preventDefault();
    setActiveView("view-four-week");
    renderFourWeekView();
    renderNavState();
  });

  safeAddListener($("#nav-recipes"), "click", (e) => {
    e.preventDefault();
    setActiveView("view-recipes");
    renderRecipesView();
    renderNavState();
  });

  safeAddListener($("#nav-import"), "click", (e) => {
    e.preventDefault();
    setActiveView("view-import");
    renderNavState();
  });

  safeAddListener($("#recipe-detail-back"), "click", () => {
    setActiveView("view-recipes");
    renderNavState();
  });
}

function wireWeeklyControls() {
  safeAddListener($("#prev-week-btn"), "click", () => {
    appState.currentWeekIndex =
      (appState.currentWeekIndex - 1 + appState.weeks.length) %
      appState.weeks.length;
    renderWeekView();
  });

  safeAddListener($("#next-week-btn"), "click", () => {
    appState.currentWeekIndex =
      (appState.currentWeekIndex + 1) % appState.weeks.length;
    renderWeekView();
  });

  safeAddListener($("#ingredients-btn"), "click", handleWeeklyIngredients);
}

function wireImportView() {
  safeAddListener($("#import-btn"), "click", (e) => {
    e.preventDefault();
    handleImportSubmit();
  });
}

async function startApp() {
  // Ensure basic week structure even if Supabase fails
  initialiseWeeks();

  await loadStateFromSupabase();
  if (!stateLoaded) {
    // Just in case
    loadStateFromLocal();
    stateLoaded = true;
  }

  wireNavigation();
  wireWeeklyControls();
  wireImportView();

  // Default view
  setActiveView("view-this-week");
  renderWeekView();
  renderFourWeekView();
  renderRecipesView();
  renderNavState();
}

document.addEventListener("DOMContentLoaded", () => {
  startApp().catch((err) => {
    console.error("Fatal error starting app:", err);
  });
});
