import { formatRecurrence } from '../src/lib/recurrence';

describe('formatRecurrence', () => {
  it('formats one-off with date', () => {
    expect(formatRecurrence({ type: 'once', due: '2026-05-09' })).toBe('Once on May 9, 2026');
  });

  it('formats daily', () => {
    expect(formatRecurrence({ type: 'daily' })).toBe('Daily');
  });

  it('formats weekly with single day', () => {
    expect(formatRecurrence({ type: 'weekly', days: [1] })).toBe('Mon');
  });

  it('formats weekly with multiple days in canonical order', () => {
    expect(formatRecurrence({ type: 'weekly', days: [5, 1, 3] })).toBe('Mon · Wed · Fri');
  });

  it('formats weekly with all 7 days as "Every day"', () => {
    expect(formatRecurrence({ type: 'weekly', days: [0, 1, 2, 3, 4, 5, 6] })).toBe('Every day');
  });
});
