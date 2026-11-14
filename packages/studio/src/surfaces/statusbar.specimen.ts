/**
 * The status bar's specimen: a project, a selection and the focused pane's zoom, as the shell would
 * project them with a page open in Design (studio.md §4.6).
 */
import { reactive } from "../reactivity";
import { defineSpecimen } from "./specimen";
import type { ProjectedField, StatusbarScope } from "./statusbar";

/** The PROJECT field: the project's name and its branch, both buttons. */
function projectField(): ProjectedField {
  return {
    id: "project",
    items: [
      {
        args: undefined,
        command: "project.open",
        disabled: false,
        key: "project.open",
        kind: "button",
        label: "Jx Studio",
        title: "Open Project",
      },
      {
        args: undefined,
        command: "panel.focus.git",
        disabled: false,
        key: "git",
        kind: "button",
        label: "main",
        title: "Show Source Control",
      },
      {
        args: undefined,
        command: null,
        disabled: false,
        key: "saved",
        kind: "state",
        label: "Saved 2 minutes ago",
        title: "",
      },
    ],
    region: "statusbar/project",
  };
}

/** The SELECTION field: the selected element, a button that opens the selection. */
function selectionField(): ProjectedField {
  return {
    id: "selection",
    items: [
      {
        args: undefined,
        command: "selection.set",
        disabled: false,
        key: "selection.set",
        kind: "button",
        label: "h1",
        title: "Select Element",
      },
    ],
    region: "statusbar/selection",
  };
}

/** The bar with a document open; `hasDocument` false draws no DOCUMENT slot and no zoom field. */
function bar(hasDocument: boolean): StatusbarScope {
  const scope: StatusbarScope = reactive<StatusbarScope>({
    chooseFit: (value) => {
      scope.zoom.fitValue = value;
    },
    hasDocument,
    leading: [projectField()],
    run: (key) => {
      const item = [...scope.leading, ...scope.trailing]
        .flatMap((field) => field.items)
        .find((candidate) => candidate.key === key);
      if (item) {
        item.title = `${item.title} (ran)`;
      }
    },
    trailing: hasDocument ? [selectionField()] : [],
    zoom: {
      fitOptions: [
        { label: "Fit width", value: "width" },
        { label: "Fit page", value: "page" },
        { label: "Actual size", value: "none" },
      ],
      fitState: hasDocument ? "shown" : "hidden",
      fitValue: "width",
      label: "125%",
      max: 100,
      min: 0,
      position: 56,
      resetHint: "Reset zoom",
      slideCommand: "canvas.setZoom",
      sliderHint: "Zoom",
      state: hasDocument ? "shown" : "hidden",
      step: 1,
      valuetext: "125%",
      zoomInHint: "Zoom in",
      zoomOutHint: "Zoom out",
    },
    zoomIn: () => {
      scope.zoom.position = Math.min(scope.zoom.max, scope.zoom.position + scope.zoom.step);
    },
    zoomOut: () => {
      scope.zoom.position = Math.max(scope.zoom.min, scope.zoom.position - scope.zoom.step);
    },
    zoomReset: () => {
      scope.zoom.position = 50;
    },
    zoomSlide: (position) => {
      scope.zoom.position = position;
    },
  });
  return scope;
}

export const specimen = defineSpecimen<StatusbarScope>({
  drive: (root) => {
    root.querySelector<HTMLElement>('[part="item"]')?.click();
    root.querySelector<HTMLElement>('[part="zoom-out"]')?.click();
    root.querySelector<HTMLElement>('[part="zoom-in"]')?.click();
    root.querySelector<HTMLElement>('[part="zoom-label"]')?.click();
    /* The slider and the Fit select report through events their own controls raise; the gestures
       that raise them are the kit's to test (ui.md §5.1), so the surface's two handlers are reached
       by the events themselves. */
    root
      .querySelector('[part="zoom-slider"]')
      ?.dispatchEvent(new Event("input", { bubbles: true }));
    root.querySelector('[part="zoom-fit"]')?.dispatchEvent(new Event("change", { bubbles: true }));
  },
  scope: () => bar(true),
  variants: { "no-document": () => bar(false) },
});
