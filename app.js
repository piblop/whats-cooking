import { RECIPES, MOODS, INGREDIENT_GROUPS, ALIASES, CUISINE_STYLES } from './data.js';
import { PHOTOS } from './photos.js';

// ---------- state (immutable updates) ----------

const state = {
  pantry: [],        // canonical ingredient names the user has
  moods: [],         // selected mood ids
  styles: [],        // selected cuisine style ids
  maxTime: null,     // minutes cap, or null
  query: '',         // free-text search over recipe names
};

function setState(patch) {
  Object.assign(state, patch);
  render();
}

// ---------- ratings (persisted per-browser) ----------

const RATINGS_KEY = 'wc-ratings';

function loadRatings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RATINGS_KEY) ?? '{}');
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

let ratings = loadRatings();

function setRating(id, value) {
  // clicking the current rating clears it
  const next = { ...ratings };
  if (next[id] === value) delete next[id];
  else next[id] = value;
  ratings = next;
  try {
    localStorage.setItem(RATINGS_KEY, JSON.stringify(ratings));
  } catch {
    // storage unavailable (private mode) — rating still applies this session
  }
  render();
}

// ---------- ingredient normalisation ----------

const KNOWN = new Set([
  ...INGREDIENT_GROUPS.flatMap((g) => g.items),
  ...RECIPES.flatMap((r) => [...r.ingredients, ...(r.optional ?? [])]),
]);

function canonical(raw) {
  const cleaned = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!cleaned) return null;
  if (ALIASES[cleaned]) return ALIASES[cleaned];
  if (KNOWN.has(cleaned)) return cleaned;
  // try naive singular
  const singular = cleaned.replace(/s$/, '');
  if (ALIASES[singular]) return ALIASES[singular];
  if (KNOWN.has(singular)) return singular;
  return cleaned; // accept unknown ingredients as-is
}

function addIngredient(raw) {
  const name = canonical(raw);
  if (!name || state.pantry.includes(name)) return;
  setState({ pantry: [...state.pantry, name] });
}

function removeIngredient(name) {
  setState({ pantry: state.pantry.filter((i) => i !== name) });
}

// ---------- scoring ----------

function scoreRecipe(recipe) {
  const have = new Set(state.pantry);
  const matched = recipe.ingredients.filter((i) => have.has(i));
  const missing = recipe.ingredients.filter((i) => !have.has(i));
  const optionalMatched = (recipe.optional ?? []).filter((i) => have.has(i));

  const coverage = matched.length / recipe.ingredients.length;
  const moodBonus = state.moods.length
    ? recipe.moods.filter((m) => state.moods.includes(m)).length / state.moods.length
    : 0;

  return {
    recipe,
    matched,
    missing,
    optionalMatched,
    coverage,
    // coverage dominates; optional matches, mood alignment and your rating break ties
    score: coverage * 100 + optionalMatched.length * 3 + moodBonus * 10 + (ratings[recipe.id] ?? 0) * 2,
  };
}

function getSuggestions() {
  let pool = RECIPES;

  if (state.moods.length) {
    pool = pool.filter((r) => state.moods.some((m) => r.moods.includes(m)));
  }
  if (state.styles.length) {
    const wanted = new Set(
      state.styles.flatMap((id) => CUISINE_STYLES.find((s) => s.id === id)?.cuisines ?? [])
    );
    pool = pool.filter((r) => wanted.has(r.cuisine));
  }
  if (state.maxTime) {
    pool = pool.filter((r) => r.time <= state.maxTime);
  }
  if (state.query) {
    const q = state.query.toLowerCase();
    pool = pool.filter(
      (r) => r.name.toLowerCase().includes(q) || r.cuisine.toLowerCase().includes(q)
    );
  }

  const scored = pool.map(scoreRecipe);

  if (state.pantry.length) {
    // require at least one matching ingredient when a pantry exists
    return scored
      .filter((s) => s.matched.length > 0)
      .sort((a, b) => b.score - a.score || a.recipe.time - b.recipe.time);
  }
  return scored.sort((a, b) => b.score - a.score || a.recipe.time - b.recipe.time);
}

// ---------- rendering ----------

const $ = (sel) => document.querySelector(sel);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

function renderPantry() {
  const wrap = $('#pantry-chips');
  wrap.replaceChildren(
    ...state.pantry.map((name) =>
      el(
        'button',
        { class: 'chip chip--pantry', title: 'Remove', onclick: () => removeIngredient(name) },
        name,
        el('span', { class: 'chip__x' }, '×')
      )
    )
  );
  $('#pantry-empty').style.display = state.pantry.length ? 'none' : 'block';
  $('#clear-pantry').style.display = state.pantry.length ? 'inline-flex' : 'none';
}

function renderQuickAdd() {
  const wrap = $('#quick-add');
  wrap.replaceChildren(
    ...INGREDIENT_GROUPS.map((group) =>
      el(
        'div',
        { class: 'quick-group' },
        el('h4', {}, group.label),
        el(
          'div',
          { class: 'quick-group__items' },
          group.items
            .filter((i) => !state.pantry.includes(i))
            .map((i) =>
              el('button', { class: 'chip chip--add', onclick: () => addIngredient(i) }, '+ ', i)
            )
        )
      )
    )
  );
}

function renderMoods() {
  const wrap = $('#mood-chips');
  wrap.replaceChildren(
    ...MOODS.map((m) => {
      const active = state.moods.includes(m.id);
      // "Not sure" is a wildcard: it clears mood filters and picks a recipe for you.
      const onclick = m.id === 'notsure'
        ? () => { setState({ moods: [] }); surprise(); }
        : () =>
            setState({
              moods: active ? state.moods.filter((id) => id !== m.id) : [...state.moods, m.id],
            });
      return el(
        'button',
        { class: `chip chip--mood${active ? ' is-active' : ''}`, onclick },
        `${m.emoji} ${m.label}`
      );
    })
  );
}

function renderStyles() {
  const wrap = $('#cuisine-chips');
  wrap.replaceChildren(
    ...CUISINE_STYLES.map((s) => {
      const active = state.styles.includes(s.id);
      return el(
        'button',
        {
          class: `chip chip--mood${active ? ' is-active' : ''}`,
          onclick: () =>
            setState({
              styles: active ? state.styles.filter((id) => id !== s.id) : [...state.styles, s.id],
            }),
        },
        `${s.emoji} ${s.label}`
      );
    })
  );
}

function matchBadge(s) {
  if (!state.pantry.length) return null;
  const pct = Math.round(s.coverage * 100);
  const cls = pct === 100 ? 'is-full' : pct >= 60 ? 'is-good' : 'is-part';
  return el(
    'div',
    { class: `match ${cls}` },
    el('div', { class: 'match__bar' }, el('div', { class: 'match__fill', style: `width:${pct}%` })),
    el('span', { class: 'match__label' }, pct === 100 ? 'You have everything!' : `${s.matched.length}/${s.recipe.ingredients.length} ingredients`)
  );
}

function photoBanner(recipe) {
  const photo = PHOTOS[recipe.id];
  if (!photo?.url) return null;
  const img = el('img', {
    class: 'card__photo',
    src: photo.url,
    alt: recipe.name,
    loading: 'lazy',
    onerror: (e) => e.target.closest('a').remove(),
  });
  return el(
    'a',
    {
      class: 'card__photo-link',
      href: photo.page,
      target: '_blank',
      rel: 'noopener noreferrer',
      title: 'Photo: Wikimedia Commons (click for credit)',
    },
    img
  );
}

function starRow(recipe) {
  const current = ratings[recipe.id] ?? 0;
  return el(
    'div',
    { class: 'stars', role: 'group', 'aria-label': `Rate ${recipe.name}` },
    [1, 2, 3, 4, 5].map((n) =>
      el(
        'button',
        {
          class: `star${n <= current ? ' is-on' : ''}`,
          title: `${n} star${n > 1 ? 's' : ''}`,
          'aria-label': `Rate ${n} of 5`,
          onclick: () => setRating(recipe.id, n),
        },
        n <= current ? '★' : '☆'
      )
    ),
    current
      ? el('span', { class: 'stars__label' }, `your rating`)
      : el('span', { class: 'stars__label stars__label--hint' }, 'rate it')
  );
}

function recipeCard(s) {
  const r = s.recipe;
  return el(
    'article',
    { class: 'card' },
    photoBanner(r),
    el(
      'header',
      { class: 'card__head' },
      el('span', { class: 'card__emoji' }, r.emoji),
      el(
        'div',
        {},
        el('h3', {}, r.name),
        el('p', { class: 'card__meta' }, `${r.cuisine} · ${r.time} min · ${r.difficulty} · Serves ${r.serves}`)
      )
    ),
    el('p', { class: 'card__blurb' }, r.blurb),
    starRow(r),
    matchBadge(s),
    el(
      'div',
      { class: 'card__ings' },
      r.ingredients.map((i) =>
        el('span', { class: `ing ${state.pantry.includes(i) ? 'ing--have' : 'ing--need'}` },
          state.pantry.includes(i) ? '✓ ' : '', i)
      )
    ),
    s.missing.length && state.pantry.length
      ? el('p', { class: 'card__missing' }, `Shopping list: ${s.missing.join(', ')}`)
      : null,
    el(
      'details',
      { class: 'card__method' },
      el('summary', {}, '📖 View recipe'),
      el('ol', {}, (r.steps ?? []).map((step) => el('li', {}, step))),
      r.source
        ? el(
            'p',
            { class: 'card__source' },
            'Reference: ',
            el('a', { href: r.source.url, target: '_blank', rel: 'noopener noreferrer' }, r.source.label)
          )
        : null
    ),
    el(
      'div',
      { class: 'card__moods' },
      r.moods.map((id) => {
        const m = MOODS.find((x) => x.id === id);
        return m ? el('span', { class: 'tag' }, `${m.emoji} ${m.label}`) : null;
      })
    )
  );
}

function render() {
  renderPantry();
  renderQuickAdd();
  renderMoods();
  renderStyles();

  const suggestions = getSuggestions();
  const grid = $('#results');
  grid.replaceChildren(...suggestions.map(recipeCard));

  $('#result-count').textContent = suggestions.length
    ? `${suggestions.length} recipe${suggestions.length === 1 ? '' : 's'} ${state.pantry.length ? 'you can make (or nearly make)' : 'to browse'}`
    : 'No matches — try removing a filter or adding more ingredients.';
}

function surprise() {
  const pool = getSuggestions();
  if (!pool.length) return;
  const idx = Math.floor(Math.random() * pool.length);
  const card = $('#results').children[idx];
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.remove('is-highlight');
    void card.offsetWidth; // restart animation
    card.classList.add('is-highlight');
  }
}

// ---------- wire up controls ----------

function init() {
  const input = $('#ingredient-input');
  const form = $('#ingredient-form');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    // support comma-separated entry: "chicken, rice, garlic"
    input.value.split(',').forEach(addIngredient);
    input.value = '';
    input.focus();
  });

  $('#clear-pantry').addEventListener('click', () => setState({ pantry: [] }));

  $('#time-filter').addEventListener('change', (e) => {
    const v = e.target.value;
    setState({ maxTime: v ? Number(v) : null });
  });

  $('#search').addEventListener('input', (e) => setState({ query: e.target.value.trim() }));

  $('#surprise').addEventListener('click', surprise);

  render();
}

init();
