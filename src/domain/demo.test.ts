import { describe, expect, it } from 'vitest';
import { demoState } from './demo.ts';
import { balances, publicState, validateEvent } from './logic.ts';

describe('demonstration fixtures', () => {
  it('has twelve fictional families including twins and leader exemption, and valid varied events', () => {
    const state = demoState();
    expect(state.families).toHaveLength(12);
    expect(state.children.filter((child) => child.familyId === 'family-1')).toHaveLength(2);
    expect(state.families.some((family) => family.exempt)).toBe(true);
    expect(state.events).toHaveLength(3);
    expect(publicState(state).events).toHaveLength(2);
    for (const event of state.events) expect(validateEvent(state, event.id)).toEqual([]);
    expect(balances(state).some((balance) => balance.completed === 0)).toBe(true);
  });

  it('returns independent copies for fresh local demonstrations', () => {
    const first = demoState();
    first.families[0].label = 'changed';
    first.events[0].draft.title = 'changed';
    expect(demoState().families[0].label).not.toBe('changed');
    expect(first.events[0].published!.title).not.toBe('changed');
  });
});
