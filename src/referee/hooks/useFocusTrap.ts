import { useEffect, useRef } from 'react';

export function useFocusTrap(isActive: boolean, onEscape?: () => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isActive) return;

    previousFocusRef.current = document.activeElement as HTMLElement;

    const container = containerRef.current;
    if (!container) return;

    // Hide all siblings from screen readers (virtual cursor containment)
    const root = document.getElementById('root');
    const hiddenElements: { el: Element; prev: string | null }[] = [];
    if (root) {
      // Walk up from container to find the modal-backdrop, then hide siblings of root
      const siblings = Array.from(document.body.children).filter(
        el => el !== root && !el.contains(container) && el.tagName !== 'SCRIPT'
      );
      siblings.forEach(el => {
        hiddenElements.push({ el, prev: el.getAttribute('aria-hidden') });
        el.setAttribute('aria-hidden', 'true');
      });
      // Also hide root's children that are not the modal
      // The modal-backdrop is typically a direct child of root or inside the component tree
      // We set aria-hidden on elements that are NOT ancestors of our container
      const rootChildren = Array.from(root.children);
      rootChildren.forEach(el => {
        if (!el.contains(container) && el !== container) {
          hiddenElements.push({ el, prev: el.getAttribute('aria-hidden') });
          el.setAttribute('aria-hidden', 'true');
        }
      });
    }

    const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = container.querySelectorAll<HTMLElement>(focusableSelector);
    if (focusables.length > 0) {
      focusables[0].focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onEscape) {
        onEscape();
        return;
      }
      if (e.key !== 'Tab') return;

      const currentFocusables = container.querySelectorAll<HTMLElement>(focusableSelector);
      if (currentFocusables.length === 0) return;

      const first = currentFocusables[0];
      const last = currentFocusables[currentFocusables.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      // Restore aria-hidden on previously hidden elements
      hiddenElements.forEach(({ el, prev }) => {
        if (prev === null) el.removeAttribute('aria-hidden');
        else el.setAttribute('aria-hidden', prev);
      });
      if (previousFocusRef.current && previousFocusRef.current.focus) {
        previousFocusRef.current.focus();
      }
    };
  }, [isActive, onEscape]);

  return containerRef;
}
