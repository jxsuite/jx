/// <reference lib="dom" />
/**
 * Insert-zone-action.ts — the click handler for the cross-origin insertion "+" affordance.
 *
 * Extracted verbatim from the studio.ts bootstrap so it can carry its own unit test (the inline
 * arrow form added two uncovered anonymous functions to the hard-to-test bootstrap). Registered by
 * name via `setInsertZoneClickHandler(runInsertZoneAction)` in studio.ts.
 *
 * The cross-origin insertion "+" (drawn by the host from posted zones) runs the parent-realm
 * slash-menu → mutateInsertNode flow on click. The menu offers the HTML elements and, under a
 * Components heading, the project's components. The host captured the zone (parentPath + index);
 * the new node is selected at its inserted path. Salvaged from the orphaned insertion-helper.ts.
 */

import { showSlashMenu } from "./slash-menu";
import { componentInstance, mutateImportComponent } from "./insert-component";
import { defaultDef } from "../panels/shared";
import { mutateInsertNode, transactDoc } from "../tabs/transact";
import { activeTab } from "../workspace/workspace";
import type { InsertZone } from "../canvas/iframe-protocol";
import type { JxPath } from "../state";

export function runInsertZoneAction(btn: HTMLElement, zone: InsertZone): void {
  showSlashMenu(btn, "", {
    onSelect: (cmd) => {
      /* A pick from the Components group inserts an instance and imports the component, as a drop
         of the same component does (§5.7); every other pick inserts the element's default. */
      const instance = cmd.component === true ? componentInstance(cmd.tag) : null;
      const def = instance ?? defaultDef(cmd.tag);
      const insertPath: JxPath = zone.insertParentPath;
      const idx = zone.index;
      const newPath = [...insertPath, "children", idx];
      const tab = activeTab.value;
      transactDoc(tab, (t) => {
        mutateInsertNode(t, insertPath, idx, def);
        if (instance) {
          mutateImportComponent(t, instance.tagName);
        }
        t.session.selection = [newPath];
      });
    },
    showFilter: true,
  });
}
