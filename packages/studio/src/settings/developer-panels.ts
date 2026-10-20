/**
 * The **Show developer panels** preference (`specs/studio.md` §5.1, §15).
 *
 * Off by default. A site author works in pages, templates, components and media, and the Site panel
 * lists those by what they are; the Files tree and the Packages list are where a developer looks,
 * so they are off the Design rail until the author asks for them. With the switch off both panels
 * are still reachable by `view.setActivity` and the palette: the switch hides two rail buttons, not
 * two capabilities.
 *
 * The value roams like the theme does (`SETTINGS.developerPanels`, scope `user`), and it is read
 * through a REACTIVE mirror rather than straight from the kernel: the rail derives its groups
 * inside an effect, and a kernel read is not tracked, so a flip in Preferences (or in another
 * window) would otherwise leave the rail drawing the old answer until something unrelated repainted
 * it.
 *
 * @docs studio/interface
 */

import { reactive } from "../reactivity";
import { SETTINGS } from "../services/settings/definitions";
import { onSettingsChanged, readStoredSetting, setSetting } from "../services/settings/kernel";

/** The stored spelling of "on". Anything else, including unset, is off. */
const ON = "true";

const _state = reactive({ on: readStoredSetting(SETTINGS.developerPanels) === ON });

onSettingsChanged((keys) => {
  if (keys.includes(SETTINGS.developerPanels.key)) {
    _state.on = readStoredSetting(SETTINGS.developerPanels) === ON;
  }
});

/** Whether the developer panels (Files, Packages) are on the rail. Tracked when read in an effect. */
export function developerPanelsShown(): boolean {
  return _state.on;
}

/** Put the developer panels on the rail, or take them off. Persisted and roaming. */
export function setDeveloperPanelsShown(show: boolean): void {
  _state.on = show;
  setSetting(SETTINGS.developerPanels, show ? ON : "");
}
