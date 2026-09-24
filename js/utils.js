/**
 * Salvis Shared Utilities — XSS sanitization, debounce, id generation
 */

const SalvisUtils = {
  escapeHtml(value) {
    const s = String(value == null ? '' : value);
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  debounce(fn, wait = 250) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  },

  clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  },

  generateId(prefix = 'id') {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  },

  safeHtml(value) {
    return this.escapeHtml(value);
  },

  padZero(n) {
    return String(n).padStart(2, '0');
  }
};

if (typeof window !== 'undefined') {
  window.SalvisUtils = SalvisUtils;
  window.escapeHtml = SalvisUtils.escapeHtml;
}