import { Directive } from '@angular/core';

/**
 * A panel floating on the map: panel colour, 1px border, 18px radius, `panelOnMap` shadow.
 * Dark panels are 97% opaque so map labels don't show through (PLAN.md §11.2).
 * Use on the element that carries the semantics: <section uiPanel>, <aside uiPanel>, <header uiPanel>.
 */
@Directive({
  selector: '[uiPanel]',
  host: { class: 'ui-panel' },
})
export class Panel {}
