/**
 * todo-app.js — handlers for todo-app.json
 *
 * `this` is bound to the component scope.
 * $items, $remaining, $remainingLabel are all signals — access via .get() / .set().
 * $remaining and $remainingLabel are computed (read-only): no .set() needed or available.
 */

export default {

  /**
   * Add a new item when Enter is pressed in the input field.
   *
   * @param {KeyboardEvent} event
   */
  addItem(event) {
    if (event.key !== 'Enter') return;
    const text = event.target.value.trim();
    if (!text) return;

    this.$items.set([
      ...this.$items.get(),
      { id: Date.now(), text, done: false },
    ]);

    event.target.value = '';
  },

  /**
   * Toggle the done state of the item at the current map index.
   * The Array namespace injects $todoIndex into the map item scope.
   *
   * @param {MouseEvent} _event
   */
  toggleItem(_event) {
    const index = this.$todoIndex ?? -1;
    if (index < 0) return;

    this.$items.set(
      this.$items.get().map((item, i) =>
        i === index ? { ...item, done: !item.done } : item
      )
    );
  },

  /**
   * Remove all completed items from the list.
   */
  clearDone() {
    this.$items.set(this.$items.get().filter(item => !item.done));
  },

};
