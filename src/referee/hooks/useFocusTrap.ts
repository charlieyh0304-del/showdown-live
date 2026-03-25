import { useEffect, useRef } from 'react';

export function useFocusTrap(isActive: boolean, onEscape?: () => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isActive) return;

    previousFocusRef.current = document.activeElement as HTMLElement;

    const container = containerRef.current;
    if (!container) return;

    // Find the modal-backdrop (closest ancestor with class modal-backdrop or the container's parent)
    const backdrop = container.closest('.modal-backdrop') || container;

    // Apply inert + aria-hidden to all siblings of the backdrop's parent that are not the backdrop
    const parent = backdrop.parentElement;
    const inertedElements: { el: Element; hadInert: boolean; hadAriaHidden: string | null }[] = [];

    if (parent) {
      Array.from(parent.children).forEach(el => {
        if (el === backdrop || el.contains(backdrop) || backdrop.contains(el)) return;
        if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'LINK') return;
        inertedElements.push({
          el,
          hadInert: (el as HTMLElement).inert ?? false,
          hadAriaHidden: el.getAttribute('aria-hidden'),
        });
        (el as HTMLElement).inert = true;
        el.setAttribute('aria-hidden', 'true');
      });
    }

    // Also inert other root-level elements
    const root = document.getElementById('root');
    if (root && root !== parent) {
      Array.from(root.children).forEach(el => {
        if (el === backdrop || el.contains(backdrop) || backdrop.contains(el)) return;
        if (el.tagName === 'SCRIPT') return;
        // Check if already inerted
        if (inertedElements.some(ie => ie.el === el)) return;
        inertedElements.push({
          el,
          hadInert: (el as HTMLElement).inert ?? false,
          hadAriaHidden: el.getAttribute('aria-hidden'),
        });
        (el as HTMLElement).inert = true;
        el.setAttribute('aria-hidden', 'true');
      });
    }

    // Focus first focusable element
    const focusableSelector = 'button:not([disabled]):not([inert]), [href]:not([inert]), input:not([disabled]):not([inert]), select:not([disabled]):not([inert]), textarea:not([disabled]):not([inert]), [tabindex]:not([tabindex="-1"]):not([inert])';
    const focusables = container.querySelectorAll<HTMLElement>(focusableSelector);
    if (focusables.length > 0) {
      focusables[0].focus();
    } else {
      // If no focusable elements (e.g., required timer with no button), focus container itself
      container.setAttribute('tabindex', '-1');
      container.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onEscape) {
        onEscape();
        return;
      }
      if (e.key !== 'Tab') return;

      const currentFocusables = container.querySelectorAll<HTMLElement>(focusableSelector);
      if (currentFocusables.length === 0) {
        e.preventDefault();
        return;
      }

      const first = currentFocusables[0];
      const last = currentFocusables[currentFocusables.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first || !container.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last || !container.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    // Also prevent focus from leaving via mouse click outside
    const handleFocusIn = (e: FocusEvent) => {
      if (container && !container.contains(e.target as Node)) {
        e.preventDefault();
        e.stopPropagation();
        const els = container.querySelectorAll<HTMLElement>(focusableSelector);
        if (els.length > 0) els[0].focus();
        else container.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', handleFocusIn);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', handleFocusIn);
      // Restore inert and aria-hidden
      inertedElements.forEach(({ el, hadInert, hadAriaHidden }) => {
        (el as HTMLElement).inert = hadInert;
        if (hadAriaHidden === null) el.removeAttribute('aria-hidden');
        else el.setAttribute('aria-hidden', hadAriaHidden);
      });
      if (previousFocusRef.current && previousFocusRef.current.focus) {
        previousFocusRef.current.focus();
      }
    };
  }, [isActive, onEscape]);

  return containerRef;
}
