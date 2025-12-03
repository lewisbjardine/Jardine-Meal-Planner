// === CONFIG =====================================================

// Supabase project (safe to expose anon key)
const SUPABASE_URL = "https://tzrmuferszuscavbujbc.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6cm11ZmVyc3p1c2NhdmJ1amJjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ3MTE0MDMsImV4cCI6MjA4MDI4NzQwM30.aRPM29TX1iv2dTRYQNxAGtu_LLAIbfzuKIWRcgNQaRE";

const STATE_TABLE = "mealplanner_state";
const STATE_ID = "global";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// === APP STATE ==================================================

let state = {
  weeks: [],
  recipes: {}, // id -> {id, title, url, imageUrl, ingredients:[], instructions:"", disliked:false}
};

let ui = {
  currentView: "planner", // 'planner' | 'recipes' | 'import' | 'recipeDetail' | 'shopping'
  plannerMode: "one-week", // 'one-week' | 'four-weeks'
  currentWeekIndex: 0,
  currentRecipeId: null,
  shoppingWeekIndex: null,
};

let saveTimeout = null;

// === INITIALISATION =============================================

document.addEventListener("DOMContentLoaded", () => {
  setupNav();
  loadState().then(() => {
    render();
  });
});

function setupNav() {
  const navButtons = document.querySelectorAll(".nav-btn");
  navButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      ui.currentView = btn.dataset.view;
      if (ui.currentView === "planner") {
        ui.currentRecipeId = null;
        ui.shoppingWeekIndex = null;
      }
      navButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      render();
    });
  });
  // Mark planner as active initially
  const plannerBtn = document.querySelector('.nav-btn[data-view="planner"]');
  if (plannerBtn) plannerBtn.classList.add("active");
}

// === SUPABASE PERSISTENCE =======================================

async function loadState() {
  try {
    const { data, error } = await supabase
      .from(STATE_TABLE)
      .select("state_json")
      .eq("id", STATE_ID)
      .maybeSingle();

    if (error) {
      console.error("Error loading state from Supabase", error);
      createDefaultState();
      return;
    }

    if (!data || !data.state_json) {
      createDefaultState();
      await saveState();
    } else {
      state = data.state_json;
      // Defensive: ensure basics exist
      if (!Array.isArray(state.weeks)) state.weeks = [];
      if (!state.recipes) state.recipes = {};
      if (state.weeks.length === 0) {
        createDefaultState();
      }
    }
  } catch (e) {
    console.error("Unexpected error loading state", e);
    createDefaultState();
  }
}

async function saveState() {
  try {
    const { error } = await supabase
      .from(STATE_TABLE)
      .upsert({ id: STATE_ID, state_json: state })
      .select();
    if (error) console.error("Error saving state to Supabase", error);
  } catch (e) {
    console.error("Unexpected error saving state", e);
  }
}

function queueSave() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveState, 800);
}

function createDefaultState() {
  // Create four empty weeks
  const weeks = [];
  for (let i = 0; i < 4; i++) {
    weeks.push({
      id: `week-${i + 1}`,
      label: `Week ${i + 1}`,
      days: DAYS.map((day) => ({
        day,
        recipeId: null,
        special: null, // 'granny' | 'eatingOut'
      })),
    });
  }
  state = {
    weeks,
    recipes: {},
  };
}

// === RENDER ROOT ================================================

function render() {
  const root = document.getElementById("view-root");
  if (!root) return;

  if (ui.currentView === "planner") {
    if (ui.currentRecipeId && ui.currentRecipeId in state.recipes) {
      root.innerHTML = renderRecipeDetailHtml();
      attachRecipeDetailHandlers();
    } else if (ui.shoppingWeekIndex != null) {
      root.innerHTML = renderShoppingListHtml();
      attachShoppingHandlers();
    } else {
      root.innerHTML = renderPlannerHtml();
      attachPlannerHandlers();
    }
  } else if (ui.currentView === "recipes") {
    root.innerHTML = renderRecipesHtml();
    attachRecipesHandlers();
  } else if (ui.currentView === "import") {
    root.innerHTML = renderImportHtml();
    attachImportHandlers();
  }
}

// === PLANNER VIEW ===============================================

function renderPlannerHtml() {
  const week = state.weeks[ui.currentWeekIndex] || state.weeks[0];

  if (ui.plannerMode === "one-week") {
    return `
      <section class="panel">
        <div class="planner-controls">
          <div class="planner-controls-left">
            <button class="btn small secondary" data-action="prev-week">◀</button>
            <div class="week-label">${week ? week.label : "Week"}</div>
            <button class="btn small secondary" data-action="next-week">▶</button>
          </div>
          <div class="planner-controls-right">
            <button class="btn small outline" data-action="toggle-mode">
              4-week view
            </button>
            <button class="btn small" data-action="week-shopping">
              🛒 Ingredients for this week
            </button>
          </div>
        </div>
        <div class="week-grid" data-week-index="${ui.currentWeekIndex}">
          ${week
            .days.map((day, index) => renderDayCard(day, ui.currentWeekIndex, index))
            .join("")}
        </div>
      </section>
    `;
  }

  // four-week mode
  const fourWeeks = state.weeks.slice(0, 4);
  return `
    <section class="panel">
      <div class="planner-controls">
        <div class="planner-controls-left">
          <div class="week-label">Four-week view</div>
        </div>
        <div class="planner-controls-right">
          <button class="btn small outline" data-action="toggle-mode">
            Single-week view
          </button>
        </div>
      </div>
      <div class="weeks-row">
        ${fourWeeks
          .map((week, wIndex) => {
            const globalIndex = wIndex; // first four weeks in array
            return `
              <div class="week-column" draggable="true"
                   data-week-index="${globalIndex}">
                <div class="week-column-header">
                  <div class="week-label">${week.label}</div>
                  <button class="btn small secondary"
                          data-action="week-shopping"
                          data-week-index="${globalIndex}">
                    🛒 Ingredients
                  </button>
                </div>
                <div class="week-grid week-grid--inner" data-week-index="${globalIndex}">
                  ${week.days
                    .map((day, dIndex) => renderDayCard(day, globalIndex, dIndex))
                    .join("")}
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function renderDayCard(day, weekIndex, dayIndex) {
  const recipe = day.recipeId ? state.recipes[day.recipeId] : null;
  const isGranny = day.special === "granny";
  const isOut = day.special === "eatingOut";

  const title =
    (recipe && recipe.title) ||
    (isGranny ? "Granny is cooking" : isOut ? "Eating out" : "Tap to add a meal");

  const tagline =
    recipe && recipe.url
      ? new URL(recipe.url).hostname.replace("www.", "")
      : isGranny
      ? "Family dinner at Granny's"
      : isOut
      ? "No cooking needed"
      : "No recipe attached yet";

  const emptyClass = !recipe && !isGranny && !isOut ? " day-empty" : "";

  return `
    <article class="day-card${emptyClass}"
             draggable="true"
             data-week-index="${weekIndex}"
             data-day-index="${dayIndex}">
      <header class="day-card-header">
        <span class="day-name">${day.day}</span>
        <div class="day-actions">
          <button class="icon-btn" title="Clear"
            data-action="clear-day"
            data-week-index="${weekIndex}"
            data-day-index="${dayIndex}">
            ✕
          </button>
          <button class="icon-btn" title="Granny day"
            data-action="toggle-granny"
            data-week-index="${weekIndex}"
            data-day-index="${dayIndex}">
            👵
          </button>
        </div>
      </header>
      <div class="day-title">${escapeHtml(title)}</div>
      <div class="day-tagline">${escapeHtml(tagline)}</div>
      ${
        isGranny
          ? `<div class="tag-granny">👵 Granny day</div>`
          : isOut
          ? `<div class="chip">Out for dinner</div>`
          : recipe
          ? ""
          : ""
      }
    </article>
  `;
}

function attachPlannerHandlers() {
  const root = document.getElementById("view-root");
  if (!root) return;

  // Top controls
  root.querySelectorAll("[data-action]").forEach((el) => {
    el.addEventListener("click", (e) => {
      const action = el.dataset.action;
      if (action === "prev-week") {
        ui.currentWeekIndex = Math.max(0, ui.currentWeekIndex - 1);
        render();
      } else if (action === "next-week") {
        ui.currentWeekIndex = Math.min(state.weeks.length - 1, ui.currentWeekIndex + 1);
        render();
      } else if (action === "toggle-mode") {
        ui.plannerMode = ui.plannerMode === "one-week" ? "four-weeks" : "one-week";
        render();
      } else if (action === "week-shopping") {
        const weekIndex =
          el.dataset.weekIndex != null ? parseInt(el.dataset.weekIndex, 10) : ui.currentWeekIndex;
        ui.shoppingWeekIndex = weekIndex;
        ui.currentRecipeId = null;
        render();
      }
    });
  });

  // Click day to open detail / select recipe
  root.querySelectorAll(".day-card").forEach((card) => {
    card.addEventListener("click", (evt) => {
      const actionEl = evt.target.closest("[data-action]");
      if (actionEl) return; // handled separately

      const weekIndex = parseInt(card.dataset.weekIndex, 10);
      const dayIndex = parseInt(card.dataset.dayIndex, 10);
      const day = state.weeks[weekIndex].days[dayIndex];

      if (day.recipeId && state.recipes[day.recipeId]) {
        ui.currentRecipeId = day.recipeId;
        ui.shoppingWeekIndex = null;
        render();
      } else {
        // Prompt user to pick a recipe
        showRecipePickerForDay(weekIndex, dayIndex);
      }
    });
  });

  // Action buttons on days (clear, granny)
  root.querySelectorAll("[data-action='clear-day']").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const w = parseInt(btn.dataset.weekIndex, 10);
      const d = parseInt(btn.dataset.dayIndex, 10);
      const day = state.weeks[w].days[d];
      day.recipeId = null;
      day.special = null;
      queueSave();
      render();
    });
  });

  root.querySelectorAll("[data-action='toggle-granny']").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const w = parseInt(btn.dataset.weekIndex, 10);
      const d = parseInt(btn.dataset.dayIndex, 10);
      const day = state.weeks[w].days[d];
      if (day.special === "granny") {
        day.special = null;
      } else {
        day.special = "granny";
        day.recipeId = null;
      }
      queueSave();
      render();
    });
  });

  // Drag & drop for days
  setupDayDragAndDrop(root);

  // Drag & drop for weeks (four-week view)
  if (ui.plannerMode === "four-weeks") {
    setupWeekDragAndDrop(root);
  }
}

function setupDayDragAndDrop(root) {
  let draggedCard = null;

  root.querySelectorAll(".day-card").forEach((card) => {
    card.addEventListener("dragstart", () => {
      draggedCard = card;
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => {
      if (draggedCard) draggedCard.classList.remove("dragging");
      draggedCard = null;
    });
    card.addEventListener("dragover", (e) => {
      e.preventDefault();
    });
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      if (!draggedCard || draggedCard === card) return;

      const fromWeek = parseInt(draggedCard.dataset.weekIndex, 10);
      const fromDay = parseInt(draggedCard.dataset.dayIndex, 10);
      const toWeek = parseInt(card.dataset.weekIndex, 10);
      const toDay = parseInt(card.dataset.dayIndex, 10);

      const fromObj = state.weeks[fromWeek].days[fromDay];
      const toObj = state.weeks[toWeek].days[toDay];

      const temp = { ...fromObj };
      state.weeks[fromWeek].days[fromDay] = { ...toObj, day: fromObj.day };
      state.weeks[toWeek].days[toDay] = { ...temp, day: toObj.day };

      queueSave();
      render();
    });
  });
}

function setupWeekDragAndDrop(root) {
  let draggedWeek = null;

  root.querySelectorAll(".week-column").forEach((col) => {
    col.addEventListener("dragstart", () => {
      draggedWeek = col;
      col.classList.add("dragging");
    });
    col.addEventListener("dragend", () => {
      if (draggedWeek) draggedWeek.classList.remove("dragging");
      draggedWeek = null;
    });
    col.addEventListener("dragover", (e) => {
      e.preventDefault();
    });
    col.addEventListener("drop", (e) => {
      e.preventDefault();
      if (!draggedWeek || draggedWeek === col) return;

      const fromIndex = parseInt(draggedWeek.dataset.weekIndex, 10);
      const toIndex = parseInt(col.dataset.weekIndex, 10);

      const temp = state.weeks[fromIndex];
      state.weeks[fromIndex] = state.weeks[toIndex];
      state.weeks[toIndex] = temp;

      queueSave();
      render();
    });
  });
}

function showRecipePickerForDay(weekIndex, dayIndex) {
  const recipeIds = Object.keys(state.recipes);
  if (recipeIds.length === 0) {
    alert("You have no recipes yet. Use the 'Add recipes' section first.");
    return;
  }

  const optionsText = recipeIds
    .map((id, i) => {
      const r = state.recipes[id];
      return `${i + 1}. ${r.title}`;
    })
    .join("\n");

  const choice = prompt(
    "Pick a recipe number for " + state.weeks[weekIndex].days[dayIndex].day + ":\n\n" + optionsText
  );
  if (!choice) return;
  const idx = parseInt(choice, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= recipeIds.length) return;

  const recipeId = recipeIds[idx];
  const recipe = state.recipes[recipeId];

  if (recipe.disliked) {
    const ok = confirm("Don't you remember you didn't like this!");
    if (!ok) return;
  }

  const day = state.weeks[weekIndex].days[dayIndex];
  day.recipeId = recipeId;
  day.special = null;
  queueSave();
  render();
}

// === RECIPE DETAIL VIEW =========================================

function renderRecipeDetailHtml() {
  const recipe = state.recipes[ui.currentRecipeId];
  if (!recipe) {
    ui.currentRecipeId = null;
    return renderPlannerHtml();
  }

  const ingredients = recipe.ingredients || [];
  const instructions = recipe.instructions || "";

  return `
    <section class="panel">
      <div class="recipe-detail-header">
        <button class="btn small secondary" data-action="back-to-planner">← Back to planner</button>
        ${
          recipe.url
            ? `<a class="btn small outline" href="${escapeHtml(
                recipe.url
              )}" target="_blank" rel="noopener">Open recipe page</a>`
            : ""
        }
      </div>
      <div class="recipe-detail-layout">
        <div>
          <img class="recipe-image" src="${escapeHtml(
            recipe.imageUrl || ""
          )}" alt="${escapeHtml(recipe.title)}" onerror="this.style.display='none'" />
        </div>
        <div>
          <div class="chip">Evening meal</div>
          <h2 class="mt-sm">${escapeHtml(recipe.title)}</h2>
          <div class="mt-sm text-muted">
            ${recipe.disliked ? "⚠️ Marked as disliked" : ""}
          </div>

          <div class="section-title mt-md">Ingredients</div>
          ${
            ingredients.length
              ? `<ul class="ingredient-list">
                   ${ingredients.map((ing) => `<li>${escapeHtml(ing)}</li>`).join("")}
                 </ul>`
              : `<p class="text-muted">No ingredients saved yet. You can edit this recipe in the Recipes section.</p>`
          }

          <div class="section-title mt-md">Method</div>
          ${
            instructions
              ? `<p>${escapeHtml(instructions)}</p>`
              : `<p class="text-muted">No method saved yet.</p>`
          }
        </div>
      </div>
    </section>
  `;
}

function attachRecipeDetailHandlers() {
  const root = document.getElementById("view-root");
  const backBtn = root.querySelector("[data-action='back-to-planner']");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      ui.currentRecipeId = null;
      render();
    });
  }
}

// === RECIPE LIST VIEW ===========================================

function renderRecipesHtml() {
  const recipes = Object.values(state.recipes);

  return `
    <section class="panel">
      <div class="panel-title">
        <h2>Recipes</h2>
        <button class="btn small" data-action="new-recipe">+ New recipe</button>
      </div>
      ${
        recipes.length === 0
          ? `<p class="text-muted">No recipes yet. Add some from the <strong>Add recipes</strong> page or create one manually.</p>`
          : `<div class="recipe-list">
              ${recipes
                .map(
                  (r) => `
                <article class="recipe-card" data-recipe-id="${r.id}">
                  <div class="recipe-card-header">
                    <div>
                      <div class="recipe-card-title">${escapeHtml(r.title)}</div>
                      ${
                        r.url
                          ? `<a href="${escapeHtml(
                              r.url
                            )}" target="_blank" rel="noopener" class="text-muted" style="font-size:0.8rem;">
                                ${escapeHtml(new URL(r.url).hostname.replace("www.", ""))}
                             </a>`
                          : ""
                      }
                    </div>
                    ${
                      r.disliked
                        ? `<span class="chip badge-disliked">Disliked</span>`
                        : ""
                    }
                  </div>
                  <div class="mt-sm text-muted" style="font-size:0.8rem;">
                    Ingredients: ${(r.ingredients || []).length} · In use on ${countUsageOfRecipe(
                    r.id
                  )} day(s)
                  </div>
                  <div class="recipe-card-footer mt-sm">
                    <div style="display:flex;gap:0.25rem;">
                      <button class="btn small secondary" data-action="edit-recipe" data-id="${
                        r.id
                      }">Edit</button>
                      <button class="btn small outline" data-action="toggle-disliked" data-id="${
                        r.id
                      }">
                        ${r.disliked ? "Unmark disliked" : "Mark disliked"}
                      </button>
                    </div>
                    <button class="btn small outline" data-action="delete-recipe" data-id="${
                      r.id
                    }">Delete</button>
                  </div>
                </article>
              `
                )
                .join("")}
            </div>`
      }
    </section>
  `;
}

function attachRecipesHandlers() {
  const root = document.getElementById("view-root");

  const newBtn = root.querySelector("[data-action='new-recipe']");
  if (newBtn) {
    newBtn.addEventListener("click", () => {
      const title = prompt("Recipe name:");
      if (!title) return;
      const id = "r_" + Date.now();
      state.recipes[id] = {
        id,
        title,
        url: "",
        imageUrl: "",
        ingredients: [],
        instructions: "",
        disliked: false,
      };
      queueSave();
      render();
    });
  }

  root.querySelectorAll("[data-action='toggle-disliked']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const r = state.recipes[id];
      if (!r) return;
      r.disliked = !r.disliked;
      queueSave();
      render();
    });
  });

  root.querySelectorAll("[data-action='delete-recipe']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const useCount = countUsageOfRecipe(id);
      if (
        !confirm(
          `Delete this recipe? It is currently used on ${useCount} day(s) in the planner.`
        )
      )
        return;

      delete state.recipes[id];
      // Clear from planner
      state.weeks.forEach((w) => {
        w.days.forEach((d) => {
          if (d.recipeId === id) d.recipeId = null;
        });
      });
      queueSave();
      render();
    });
  });

  root.querySelectorAll("[data-action='edit-recipe']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const recipe = state.recipes[id];
      if (!recipe) return;

      const newTitle = prompt("Recipe title:", recipe.title);
      if (!newTitle) return;
      const url = prompt("Recipe URL (BBC Good Food etc.):", recipe.url || "");
      const imageUrl = prompt("Image URL (optional):", recipe.imageUrl || "");
      const ingredientsStr = prompt(
        "Ingredients (one per line):",
        (recipe.ingredients || []).join("\n")
      );
      const instructions = prompt(
        "Method / notes:",
        recipe.instructions || ""
      );

      recipe.title = newTitle;
      recipe.url = url || "";
      recipe.imageUrl = imageUrl || "";
      recipe.ingredients = ingredientsStr
        ? ingredientsStr.split("\n").map((s) => s.trim()).filter(Boolean)
        : [];
      recipe.instructions = instructions || "";

      queueSave();
      render();
    });
  });
}

function countUsageOfRecipe(recipeId) {
  let count = 0;
  state.weeks.forEach((w) => {
    w.days.forEach((d) => {
      if (d.recipeId === recipeId) count++;
    });
  });
  return count;
}

// === IMPORT VIEW ================================================

function renderImportHtml() {
  return `
    <section class="panel">
      <div class="panel-title">
        <h2>Add recipes from URLs</h2>
      </div>
      <div class="import-layout">
        <div>
          <p class="text-muted">
            Paste one or more URLs from <strong>BBC Good Food</strong> (or any recipe site),
            one per line. The planner will create simple recipe entries and
            offer to place them into the next available evening slot.
          </p>
          <textarea rows="8" id="url-input"
            placeholder="https://www.bbcgoodfood.com/recipes/..." ></textarea>
          <div class="mt-sm">
            <button class="btn" data-action="import-urls">
              Import &amp; place into planner
            </button>
          </div>
          <p class="text-muted" style="font-size:0.8rem;margin-top:0.5rem;">
            For now, titles and ingredients are not scraped automatically.
            After import, you can refine each recipe in the <strong>Recipes</strong> section.<br>
            To use ChatGPT to parse recipe pages automatically, you can later wire this
            button to a secure backend (e.g. Supabase Edge Function) that calls the
            OpenAI API with your secret key.
          </p>
        </div>
        <div>
          <h3 style="font-size:0.95rem;margin-top:0;">How it works</h3>
          <ul class="text-muted" style="font-size:0.85rem;">
            <li>Each URL becomes a recipe with a guessed title.</li>
            <li>If that recipe was previously marked as <em>disliked</em>, you'll see
                a warning when assigning it to a day: “Don't you remember you didn't like this!”</li>
            <li>Recipes are placed into the next free slots starting from Week 1 → Sunday.</li>
          </ul>
        </div>
      </div>
    </section>
  `;
}

function attachImportHandlers() {
  const root = document.getElementById("view-root");
  const importBtn = root.querySelector("[data-action='import-urls']");
  if (!importBtn) return;

  importBtn.addEventListener("click", () => {
    const textarea = document.getElementById("url-input");
    const urls = textarea.value
      .split("\n")
      .map((u) => u.trim())
      .filter((u) => u.length > 0);

    if (urls.length === 0) {
      alert("Please paste at least one URL.");
      return;
    }

    urls.forEach((url) => {
      const id = "r_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
      const hostname = (() => {
        try {
          return new URL(url).hostname.replace("www.", "");
        } catch {
          return "Recipe";
        }
      })();
      const title = "New recipe from " + hostname;

      state.recipes[id] = {
        id,
        title,
        url,
        imageUrl: "",
        ingredients: [],
        instructions: "",
        disliked: false,
      };

      placeRecipeIntoNextFreeSlot(id);
    });

    queueSave();
    alert("Recipes added and placed into the next free evening slots.");
    textarea.value = "";
  });
}

function placeRecipeIntoNextFreeSlot(recipeId) {
  for (const week of state.weeks) {
    for (const day of week.days) {
      if (!day.recipeId && !day.special) {
        day.recipeId = recipeId;
        return;
      }
    }
  }
}

// === SHOPPING LIST VIEW =========================================

function renderShoppingListHtml() {
  const week = state.weeks[ui.shoppingWeekIndex];
  if (!week) {
    ui.shoppingWeekIndex = null;
    return renderPlannerHtml();
  }

  const { aggregated, missingRecipes } = buildAggregatedIngredients(week);

  const itemsHtml = Object.entries(aggregated)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([name, qty]) => `
      <div class="shopping-item">
        ${escapeHtml(name)}${qty ? ` – ${escapeHtml(qty)}` : ""}
      </div>
    `
    )
    .join("");

  return `
    <section class="panel">
      <div class="panel-title">
        <h2>Weekly ingredients · ${escapeHtml(week.label)}</h2>
        <button class="btn small secondary" data-action="back-to-planner">← Back to planner</button>
      </div>
      <p class="text-muted" style="font-size:0.85rem;">
        This list aggregates ingredients across all recipes for this week.
        You can refine ingredients on each recipe in the <strong>Recipes</strong> section.
      </p>
      <div class="shopping-list-grid mt-md">
        ${itemsHtml || `<span class="text-muted">No ingredients found for this week.</span>`}
      </div>
      ${
        missingRecipes.length
          ? `<p class="text-muted mt-md" style="font-size:0.8rem;">
              Some recipes for this week have no saved ingredients yet:<br>
              ${missingRecipes.map((r) => "• " + escapeHtml(r)).join("<br>")}
             </p>`
          : ""
      }
      <p class="text-muted mt-md" style="font-size:0.8rem;">
        <strong>ChatGPT integration:</strong> if you set up a backend endpoint
        that calls the OpenAI API, you can plug it into this screen to
        automatically parse ingredients from recipe URLs. See the
        <code>fetchAggregatedIngredientsFromAI</code> function in <code>app.js</code>.
      </p>
    </section>
  `;
}

function buildAggregatedIngredients(week) {
  const aggregated = {};
  const missingRecipes = [];

  week.days.forEach((day) => {
    if (!day.recipeId) return;
    const recipe = state.recipes[day.recipeId];
    if (!recipe) return;

    if (!recipe.ingredients || recipe.ingredients.length === 0) {
      missingRecipes.push(recipe.title);
      return;
    }

    recipe.ingredients.forEach((line) => {
      // Very simple heuristic: split into "qty" + "name"
      const parts = line.split(" ");
      if (parts.length === 1) {
        const name = parts[0];
        aggregated[name] = aggregated[name] || "";
      } else {
        const qty = parts[0];
        const name = parts.slice(1).join(" ");
        if (!aggregated[name]) aggregated[name] = qty;
        else aggregated[name] += " + " + qty;
      }
    });
  });

  return { aggregated, missingRecipes };
}

function attachShoppingHandlers() {
  const root = document.getElementById("view-root");
  const backBtn = root.querySelector("[data-action='back-to-planner']");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      ui.shoppingWeekIndex = null;
      render();
    });
  }
}

// Placeholder for future AI-powered aggregation
async function fetchAggregatedIngredientsFromAI(week) {
  /*
    SECURITY NOTE:
    --------------
    Do NOT call the OpenAI API directly from this browser code with your API key.
    Instead, create a tiny backend (e.g. Supabase Edge Function, Cloudflare Worker,
    Netlify function) that:

      1) Receives the week's recipe URLs / text.
      2) Calls the OpenAI API with YOUR secret key.
      3) Returns a JSON object of aggregated ingredients.

    Then call that endpoint here, e.g.:

      const res = await fetch("https://your-edge-function-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week }),
      });
      const data = await res.json();
      return data.aggregatedIngredients;

    For now, the app uses the local ingredient aggregation in buildAggregatedIngredients().
  */
  return null;
}

// === UTIL =======================================================

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
