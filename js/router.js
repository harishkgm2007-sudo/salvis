/**
 * Declarative View Router
 * Replaces ad-hoc `style.cssText = 'display: ... !important;'` toggling with a
 * single, stateful navigation API. Views: 'auth' | 'dashboard' | 'profile'.
 */

const VIEW_RECORDS = {
  auth: {
    wrapper: 'authWrapper',
    render: () => {
      if (typeof window.showAuthLoginView === 'function') window.showAuthLoginView();
    }
  },
  dashboard: {
    wrapper: 'mainAppWrapper',
    render: () => {
      if (typeof window.UIRenderer !== 'undefined' && window.UIRenderer.renderAll) {
        window.UIRenderer.renderAll();
      }
    }
  },
  profile: {
    wrapper: 'profileAppWrapper',
    render: () => {
      if (typeof window.renderProfileView === 'function') window.renderProfileView();
    }
  }
};

class Router {
  static currentView = null;

  static getViewName() {
    return this.currentView;
  }

  static navigate(viewName, opts = {}) {
    const record = VIEW_RECORDS[viewName];
    if (!record) {
      if (typeof console !== 'undefined') {
        console.warn('[Router] Unknown view:', viewName);
      }
      return null;
    }

    Object.values(VIEW_RECORDS).forEach((r) => {
      const el = document.getElementById(r.wrapper);
      if (el) el.style.cssText = 'display: none !important; opacity: 0; visibility: hidden;';
    });

    const target = document.getElementById(record.wrapper);
    if (target) {
      target.style.cssText = 'display: flex !important; opacity: 1; visibility: visible;';
    }

    if (opts.noScroll !== true) {
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {
        try { window.scrollTo(0, 0); } catch (e2) {}
      }
    }

    this.currentView = viewName;

    if (!opts.manualRender && typeof record.render === 'function') {
      try {
        record.render();
      } catch (e) {
        if (typeof console !== 'undefined') console.error('[Router] render error for view:', viewName, e);
      }
    }

    return viewName;
  }
}

if (typeof window !== 'undefined') {
  window.Router = Router;
  // Backwards-compatible bridge used by ui.js / checkAuthState.
  window.showPageView = (viewName, opts) => Router.navigate(viewName, opts);
}