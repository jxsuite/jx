/**
 * index.js — external functions for the examples index page.
 * Used via $src on $prototype: "Function" entries.
 */

const SOURCES = {
  counter:    './counter/counter.json',
  computed:   './computed/user-card.json',
  list:       './list/dynamic-list.json',
  fetch:      './fetch/fetch-demo.json',
  switch:     './switch/router.json',
  form:       './form/contact-form.json',
  responsive: './responsive/responsive-card.json',
  todo:       './todo/todo-app.json',
};

async function loadSource(id, state) {
  state.sourceText = 'Loading...';
  try {
    const res  = await fetch(SOURCES[id]);
    const text = await res.text();
    state.sourceText = text;
  } catch (e) {
    state.sourceText = `// Error loading source\n// ${e.message}`;
  }
}

export async function selectTab(state, event) {
  const id = event.currentTarget.dataset.tab;
  if (!id || !SOURCES[id]) return;
  state.activeTab = id;
  state.iframeSrc = `./${id}/index.html`;
  await loadSource(id, state);
}

export async function onMount(state) {
  await loadSource(state.activeTab, state);
}
