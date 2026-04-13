import { describe, it, expect } from 'vitest';
import { parseTimeDisplay } from './locale';

describe('parseTimeDisplay', () => {
  it('returns HH:MM as-is', () => {
    expect(parseTimeDisplay('14:30')).toBe('14:30');
  });

  it('returns HH:MM:SS as-is', () => {
    expect(parseTimeDisplay('09:15:30')).toBe('09:15:30');
  });

  it('returns single-digit hour as-is', () => {
    expect(parseTimeDisplay('9:05')).toBe('9:05');
  });

  it('extracts HH:MM from Korean AM/PM format', () => {
    expect(parseTimeDisplay('오전 9:30')).toBe('9:30');
    expect(parseTimeDisplay('오후 2:15')).toBe('2:15');
  });

  it('extracts HH:MM from English AM/PM format', () => {
    expect(parseTimeDisplay('9:30 AM')).toBe('9:30');
    expect(parseTimeDisplay('2:15 PM')).toBe('2:15');
  });

  it('returns original string if unparseable', () => {
    expect(parseTimeDisplay('not a time')).toBe('not a time');
  });
});
