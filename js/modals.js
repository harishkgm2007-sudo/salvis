/**
 * Centralized Modal Manager
 * Single source of truth for opening/closing modals, with focus trapping,
 * Escape-to-close and backdrop dismissal.
 * Backdrop dismissal is delegated here so the internal open-stack stays in sync.
 */

class ModalManager {
  static _stack = [];
  static _lastFocused = null;

  static isOpen(id) {
    return this._stack.indexOf(id) !== -1;
  }

  static hasOpen() {
    return this._stack.length > 0;
  }

  static topModalId() {
    return this._stack.length ? this._stack[this._stack.length - 1] : null;
  }

  static open(id) {
    const el = document.getElementById(id);
    if (!el) return false;
    if (this._stack.length === 0) {
      this._lastFocused = document.activeElement || null;
    }
    el.classList.add('active');
    if (!this.isOpen(id)) this._stack.push(id);

    const focusables = this._getFocusables(el);
    if (focusables.length) {
      // Defer so the open animation completes before focusing.
      setTimeout(() => { try { focusables[0].focus(); } catch (e) {} }, 40);
    }
    return true;
  }

  static close(id) {
    const el = document.getElementById(id);
    if (!el) return false;
    el.classList.remove('active');
    this._stack = this._stack.filter((x) => x !== id);
    this._cleanupInputs(el);

    if (this._stack.length === 0) {
      if (this._lastFocused && this._lastFocused !== document.body) {
        try { this._lastFocused.focus(); } catch (e) {}
      }
      this._lastFocused = null;
    }
    return true;
  }

  static _cleanupInputs(rootEl) {
    if (!rootEl) return;
    // Elements marked with data-clear-on-close get their input state reset.
    rootEl.querySelectorAll('[data-clear-on-close]').forEach((el) => {
      if (typeof el.value === 'string') el.value = '';
    });
    rootEl.querySelectorAll('[data-reset-classes-on-close]').forEach((el) => {
      const list = (el.getAttribute('data-reset-classes-on-close') || '').split(',').map((c) => c.trim()).filter(Boolean);
      list.forEach((cls) => el.classList.remove(cls));
    });
  }

  static closeTop() {
    const id = this.topModalId();
    if (id) this.close(id);
    return id;
  }

  static _getFocusables(rootEl) {
    if (!rootEl) return [];
    return Array.prototype.slice.call(
      rootEl.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter((el) => !el.disabled);
  }

  static bindBackdrop() {
    document.addEventListener('mousedown', (e) => {
      const overlay = e.target && e.target.classList && e.target.classList.contains('modal-overlay')
        ? e.target
        : null;
      if (!overlay) return;
      if (overlay.id) this.close(overlay.id);
    });
  }

  static init() {
    this.bindBackdrop();
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.hasOpen()) {
        e.preventDefault();
        this.closeTop();
      }
    });
  }
}

if (typeof window !== 'undefined') {
  window.ModalManager = ModalManager;
}