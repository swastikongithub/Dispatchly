import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Avatar } from './avatar';
import { SegmentedProgress } from './progress';
import { Roll } from './roll';

@Component({
  imports: [Avatar, Roll, SegmentedProgress],
  template: `
    <ui-avatar [name]="name()" />
    <ui-roll [value]="value()" />
    <ui-segmented-progress label="Order progress" [steps]="steps" [current]="2" [partial]="0.55" />
  `,
})
class Host {
  readonly name = signal('Aman Verma');
  readonly value = signal('8 min');
  readonly steps = ['Placed', 'Picked up', 'On the way', 'Delivered'];
}

describe('ui', () => {
  function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('shows two initials for a name', () => {
    const { fixture, el } = render();
    expect(el.querySelector('ui-avatar')!.textContent!.trim()).toBe('AV');
    fixture.componentInstance.name.set('Ananya K.');
    fixture.detectChanges();
    expect(el.querySelector('ui-avatar')!.textContent!.trim()).toBe('AK');
  });

  it('rolls digits but keeps the plain value for screen readers', () => {
    const { fixture, el } = render();
    const roll = el.querySelector('ui-roll')!;
    expect(roll.querySelector('.sr-only')!.textContent).toBe('8 min');
    expect(roll.querySelectorAll('.column').length).toBe(1);
    fixture.componentInstance.value.set('12 min');
    fixture.detectChanges();
    expect(roll.querySelectorAll('.column').length).toBe(2);
    const strips = [...roll.querySelectorAll<HTMLElement>('.strip')];
    expect(strips.map((s) => s.style.getPropertyValue('--digit'))).toEqual(['1', '2']);
  });

  it('fills finished steps, part of the current one, and marks it current', () => {
    const { el } = render();
    const fills = [...el.querySelectorAll<HTMLElement>('ui-segmented-progress .fill')];
    expect(fills.map((f) => f.style.getPropertyValue('--progress'))).toEqual([
      '1',
      '1',
      '0.55',
      '0',
    ]);
    expect(el.querySelector('[aria-current="step"]')!.textContent!.trim()).toBe('On the way');
  });
});
