/**
 * fetch-demo.js — computed functions for the live search demo.
 *
 * Complex computeds live here; simple handlers and one-liners
 * are declared inline with `body` in fetch-demo.json.
 */

export function filteredPosts(state) {
  const posts = state.allPosts;
  if (!Array.isArray(posts)) return [];
  const term = (state.searchTerm || '').toLowerCase().trim();
  const uid  = String(state.selectedUserId || '');
  return posts.filter(p =>
    (!term || p.title.toLowerCase().includes(term) || p.body.toLowerCase().includes(term)) &&
    (!uid  || String(p.userId) === uid)
  );
}

export function paginatedPosts(state) {
  const filtered = state.filteredPosts;
  if (!Array.isArray(filtered)) return [];
  const start = (state.currentPage - 1) * state.perPage;
  return filtered.slice(start, start + state.perPage);
}

export function statsText(state) {
  if (!state.allPosts) return 'Loading…';
  const total    = state.allPosts.length;
  const filtered = (state.filteredPosts || []).length;
  return (state.searchTerm || state.selectedUserId)
    ? `${filtered} of ${total} posts`
    : `${total} posts`;
}
