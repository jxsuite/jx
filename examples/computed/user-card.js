/**
 * User-card.js — external functions for user-card.json
 *
 * Demonstrates the external $src pattern for $prototype: "Function" entries. The changeName handler
 * is loaded via $src in the JSON.
 */

const NAMES = [
  { first: "Jane", last: "Smith" },
  { first: "Bob", last: "Johnson" },
  { first: "Alice", last: "Wilson" },
  { first: "Priya", last: "Patel" },
  { first: "Marcus", last: "Chen" },
  { first: "John", last: "Doe" },
];

export function changeName(state) {
  const candidate = NAMES[Math.floor(Math.random() * NAMES.length)];
  state.firstName = candidate.first;
  state.lastName = candidate.last;
}
