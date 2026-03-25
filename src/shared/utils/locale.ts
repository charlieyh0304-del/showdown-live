/**
 * Returns the current locale string based on language setting.
 * Used for toLocaleTimeString, toLocaleDateString, etc.
 */
export function getLocale(): string {
  const lang = localStorage.getItem('showdown_language') || 'ko';
  return lang === 'en' ? 'en-US' : 'ko-KR';
}

/** Format current time for score history entries */
export function formatTime(date?: Date): string {
  const d = date || new Date();
  return d.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Format time short (HH:MM) */
export function formatTimeShort(date?: Date): string {
  const d = date || new Date();
  return d.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' });
}

/** Format date */
export function formatDate(date?: Date): string {
  const d = date || new Date();
  return d.toLocaleDateString(getLocale());
}

/** Format date+time */
export function formatDateTime(date?: Date): string {
  const d = date || new Date();
  return d.toLocaleString(getLocale());
}

/** Parse a time string that may be in Korean or English locale format */
export function parseTimeDisplay(time: string): string {
  // Already in HH:MM or HH:MM:SS format
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(time)) return time;
  // Korean AM/PM format (오전/오후) or English AM/PM
  const match = time.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    const h = match[1];
    const m = match[2];
    return `${h}:${m}`;
  }
  // Try parsing as date
  const d = new Date(time);
  if (!isNaN(d.getTime())) {
    return d.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' });
  }
  return time;
}
