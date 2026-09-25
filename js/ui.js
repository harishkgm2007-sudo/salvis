/**
 * UI Controller — rendering, modals, PIN interceptor, animations, export
 */

const _storageSvc = () => typeof StorageService !== 'undefined' ? StorageService : (window.StorageService || {});
const getAuthService = () => typeof AuthService !== 'undefined' ? AuthService : (window.AuthService || {});
const getSavingsCalculator = () => typeof SavingsCalculator !== 'undefined' ? SavingsCalculator : (window.SavingsCalculator || {});
const getTrajectoryChart = () => typeof TrajectoryChart !== 'undefined' ? TrajectoryChart : (window.TrajectoryChart || {});
const getNotifications = () => typeof NotificationService !== 'undefined' ? NotificationService : (window.NotificationService || {});

const esc = (v) => {
  const utils = typeof SalvisUtils !== 'undefined' ? SalvisUtils : (window.SalvisUtils || {});
  return utils.escapeHtml ? utils.escapeHtml(v) : String(v == null ? '' : v);
};

const MONTH_MULTIPLIER = { daily: 30, weekly: 4.33, biweekly: 2.17, monthly: 1 };

const FREQUENCY_OPTIONS = {
  daily: 'Daily Micro-Save',
  weekly: 'Weekly Cadence',
  biweekly: 'Bi-Weekly Cadence',
  monthly: 'Monthly Cadence'
};

class UIRenderer {
  static state = {
    activeFilter: 'all',
    searchQuery: '',
    sortMode: 'recent',
    selectedGoalForDetail: null,
    selectedGoalForPayment: null,
    pendingActionWithPin: null,
    pendingConfirm: null,
    pendingOtp: null,
    lastReceiptTx: null,
    pinValue: '',
    wizardStep: 1,
    wizardData: null,
    currentVaultType: 'standard',
    vaultType: 'personal',
    shoppingMode: 'url',
    fetchedProductData: null,
    trackedVaultRefreshTimer: null,
    trackedVaultRefreshInFlight: false,
    authRenderTimer: null,
    authRenderUserId: '',
    regionRefreshHandler: null
  };

  static init() {
    this.state.activeFilter = 'all';
    this.state.searchQuery = '';
    this.state.sortMode = 'recent';
    this.bindEvents();
    this.bindKeyboardShortcuts();
    this.checkAuthState();
    this.startTrackedVaultRefresh();
    const notif = getNotifications();
    if (notif && notif.startAutoRefresh) notif.startAutoRefresh();
  }

  static checkAuthState() {
    try {
      if (this.state.authRenderTimer) {
        clearTimeout(this.state.authRenderTimer);
        this.state.authRenderTimer = null;
      }

      const auth = getAuthService();
      const user = auth && typeof auth.getCurrentUser === 'function' ? auth.getCurrentUser() : null;
      if (!user) {
        this.state.authRenderUserId = '';
        if (typeof window.showPageView === 'function') window.showPageView('auth');
        else this._fallbackView('auth');
        if (typeof window.showAuthLoginView === 'function') window.showAuthLoginView();
        return;
      }

      const userId = String(user.id);
      this.state.authRenderUserId = userId;
      this.startTrackedVaultRefresh();
      window.scrollTo({ top: 0 });
      if (typeof window.showPageView === 'function') window.showPageView('dashboard');
      else this._fallbackView('dashboard');

      this.renderSkeletons();
      const notif = getNotifications();
      if (notif && notif.updateBell) notif.updateBell();
      this.refreshRegionForSession(user);
      this.state.authRenderTimer = setTimeout(() => {
        this.state.authRenderTimer = null;
        const current = auth && typeof auth.getCurrentUser === 'function' ? auth.getCurrentUser() : null;
        if (!current || String(current.id) !== userId) return;
        this.renderAll();
      }, 280);
    } catch (err) {
      console.error('checkAuthState error:', err);
    }
  }

  static refreshRegionForSession(user = null) {
    const auth = getAuthService();
    const session = user || (auth && typeof auth.getCurrentUser === 'function' ? auth.getCurrentUser() : null);
    if (!session || !auth || typeof auth.refreshRegionFromIp !== 'function' || session.regionSource === 'manual') return;

    if (!this.state.regionRefreshHandler) {
      this.state.regionRefreshHandler = (result) => {
        if (!result) return;
        const currentAuth = getAuthService();
        const current = currentAuth && typeof currentAuth.getCurrentUser === 'function'
          ? currentAuth.getCurrentUser()
          : null;
        const resultUserId = result.user && result.user.id;
        if (!current || (resultUserId && String(current.id) !== String(resultUserId)) || current.regionSource === 'manual') return;
        if (result.updated) {
          if (typeof window.renderProfileView === 'function') window.renderProfileView();
          this.renderAll();
        } else if (typeof window.renderProfileView === 'function') {
          window.renderProfileView();
        }
      };
    }
    const pending = auth.refreshRegionFromIp({ onUpdate: this.state.regionRefreshHandler });
    if (pending && typeof pending.catch === 'function') pending.catch(() => {});
  }

  static _fallbackView(view) {
    const authWrapper = document.getElementById('authWrapper');
    const mainWrapper = document.getElementById('mainAppWrapper');
    const profileWrapper = document.getElementById('profileAppWrapper');
    if (authWrapper) authWrapper.style.display = '';
    if (mainWrapper) mainWrapper.style.display = '';
    if (profileWrapper) profileWrapper.style.display = '';
    if (view === 'auth' && authWrapper) authWrapper.style.display = 'flex';
    if (view === 'dashboard' && mainWrapper) mainWrapper.style.display = 'flex';
    if (view === 'profile' && profileWrapper) profileWrapper.style.display = 'flex';
  }

  static renderSkeletons() {
    const grid = document.getElementById('goalsGrid');
    if (grid) {
      grid.innerHTML = Array.from({ length: 3 }).map(() => `
        <div class="goal-card skeleton-card">
          <div class="skeleton-line" style="width: 60%; height: 18px;"></div>
          <div class="skeleton-line" style="width: 40%; height: 12px;"></div>
          <div class="skeleton-line" style="width: 100%; height: 34px; margin: 1rem 0;"></div>
          <div class="skeleton-line" style="width: 100%; height: 12px;"></div>
        </div>
      `).join('');
    }
  }

  static renderAll() {
    try { this.renderHeader(); } catch (e) { console.error('Header render error:', e); }
    try { this.renderMetrics(); } catch (e) { console.error('Metrics render error:', e); }
    try { this.renderGoals(); } catch (e) { console.error('Goals render error:', e); }
    try { this.renderChart(); } catch (e) { console.error('Chart render error:', e); }
    try { this.renderAnalytics(); } catch (e) { console.error('Analytics render error:', e); }

    const goals = _storageSvc().getGoals();
    const notif = getNotifications();
    if (notif && notif.refresh) {
      try { notif.refresh(goals); } catch (e) {}
    }
  }

  // ===================== TOASTS =====================

  static showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast' + (type === 'error' ? ' toast-error' : type === 'warning' ? ' toast-warning' : '');
    toast.innerHTML = `
      <span class="toast-icon">${type === 'error' ? '❌' : type === 'warning' ? '⚠️' : '✅'}</span>
      <span class="toast-msg">${esc(message)}</span>
      <span class="toast-progress"></span>
    `;
    container.appendChild(toast);

    const duration = 3500;
    const progress = toast.querySelector('.toast-progress');
    progress.style.animationDuration = duration + 'ms';

    setTimeout(() => {
      toast.classList.add('toast-out');
      setTimeout(() => toast.remove(), 360);
    }, duration);
  }

  // ===================== HEADER =====================

  static renderHeader() {
    const user = getAuthService().getCurrentUser();
    const walletBalance = _storageSvc().getWalletBalance();

    const walletEl = document.getElementById('walletBalanceDisplay');
    if (walletEl) {
      const calc = getSavingsCalculator();
      this.animateNumber(walletEl, walletBalance, (v) => calc.formatCurrency(v), 700);
    }

    const userNameEl = document.getElementById('userNameDisplay');
    const userAvatarEl = document.getElementById('userAvatarDisplay');
    if (userNameEl && user) userNameEl.textContent = user.name;
    if (userAvatarEl && user) {
      if (user.avatar && (user.avatar.indexOf('data:image/') === 0 || user.avatar.indexOf('http') === 0)) {
        userAvatarEl.innerHTML = `<img src="${user.avatar}" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover;" alt="Avatar">`;
      } else {
        userAvatarEl.textContent = user.avatar || '👨‍💼';
      }
    }
  }

  // ===================== METRICS =====================

  static renderMetrics() {
    const goals = _storageSvc().getGoals();
    const activeGoals = goals.filter((g) => g.status === 'active');

    const totalSaved = goals.reduce((acc, g) => acc + (g.savedAmount || 0), 0);
    const totalTarget = goals.reduce((acc, g) => acc + (g.targetAmount || 0), 0);
    const overallPct = totalTarget > 0 ? (totalSaved / totalTarget) * 100 : 0;

    const monthlyVelocity = activeGoals.reduce((sum, g) => {
      const schedule = getSavingsCalculator().calculateSchedule(
        g.targetAmount, g.savedAmount, g.startDate, g.targetDate, g.frequency
      );
      const mult = MONTH_MULTIPLIER[g.frequency] || 1;
      return sum + schedule.paymentPerInterval * mult;
    }, 0);

    const calc = getSavingsCalculator();
    const totalSavedEl = document.getElementById('metricTotalSaved');
    const overallPctEl = document.getElementById('metricOverallPct');
    const activeGoalsEl = document.getElementById('metricActiveGoals');
    const velocityEl = document.getElementById('metricVelocity');

    if (totalSavedEl) this.animateNumber(totalSavedEl, totalSaved, (v) => calc.formatCurrency(v));
    if (overallPctEl) this.animateNumber(overallPctEl, overallPct, (v) => `${Math.min(100, v).toFixed(1)}%`);
    if (activeGoalsEl) this.animateNumber(activeGoalsEl, activeGoals.length, (v) => `${Math.round(v)} Vaults`);
    if (velocityEl) this.animateNumber(velocityEl, monthlyVelocity, (v) => `${calc.formatCurrency(v)}/mo`);
  }

  static animateNumber(el, target, formatter, duration = 950) {
    if (!el) return;
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = formatter(target * eased);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ===================== GOALS =====================

  static _applyQueryFilters(goals) {
    let out = goals.slice();

    if (this.state.activeFilter === 'active') out = out.filter((g) => g.status === 'active');
    else if (this.state.activeFilter === 'completed') out = out.filter((g) => g.status === 'completed');
    else if (this.state.activeFilter === 'paused') out = out.filter((g) => g.status === 'paused');

    const q = this.state.searchQuery.trim().toLowerCase();
    if (q) {
      out = out.filter((g) =>
        String(g.itemName || '').toLowerCase().indexOf(q) !== -1 ||
        String(g.category || '').toLowerCase().indexOf(q) !== -1 ||
        (g.status || '').toLowerCase().indexOf(q) !== -1
      );
    }

    switch (this.state.sortMode) {
      case 'progress':
        out.sort((a, b) => {
          const pa = a.targetAmount > 0 ? a.savedAmount / a.targetAmount : 0;
          const pb = b.targetAmount > 0 ? b.savedAmount / b.targetAmount : 0;
          return pb - pa;
        });
        break;
      case 'amount':
        out.sort((a, b) => b.targetAmount - a.targetAmount);
        break;
      case 'date':
        out.sort((a, b) => new Date(a.targetDate) - new Date(b.targetDate));
        break;
      default:
        out.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    }
    return out;
  }

  static renderGoals() {
    const goalsGrid = document.getElementById('goalsGrid');
    if (!goalsGrid) return;

    const allGoals = _storageSvc().getGoals();
    const goals = this._applyQueryFilters(allGoals);
    const calc = getSavingsCalculator();

    if (goals.length === 0) {
      const isFiltered = this.state.searchQuery || this.state.activeFilter !== 'all' || this.state.sortMode !== 'recent';
      goalsGrid.innerHTML = `
        <div class="empty-state">
          <div class="empty-illustration">${isFiltered ? '🔍' : '🏦'}</div>
          <h3>${isFiltered ? 'No Vaults Match Your Search' : 'No Active Vaults'}</h3>
          <p>${isFiltered ? 'Try a different search or filter.' : 'Create a target-driven savings vault to begin.'}</p>
          ${isFiltered ? '' : '<button class="btn btn-primary" onclick="window.UIRenderer.openWizardModal()">+ Create Savings Vault</button>'}
        </div>
      `;
      return;
    }

    goalsGrid.innerHTML = goals.map((goal) => {
      const sched = getSavingsCalculator().calculateSchedule(
        goal.targetAmount, goal.savedAmount, goal.startDate, goal.targetDate, goal.frequency
      );

      const statusBadge =
        goal.status === 'active'
          ? '<span class="badge badge-active">Active Vault</span>'
          : goal.status === 'paused'
          ? '<span class="badge badge-paused">Paused</span>'
          : '<span class="badge badge-completed">Goal Reached</span>';

      const overpaid = sched.isOverpaid
        ? `<div class="overpaid-banner">⚠️ Overpaid by ${calc.formatCurrency(sched.surplus)}</div>`
        : '';
      const isTracked = goal.is_tracked === true;
      const isShopping = goal.vaultType === 'shopping' || isTracked;
      const safeImage = isShopping ? this._safeExternalUrl(goal.image_url) : '';
      const storeName = goal.store_name || (isShopping ? this._getStoreName(goal.product_url) : '');
      const previousPrice = parseFloat(goal.previousTrackedPrice || 0);
      const currentPrice = parseFloat(goal.lastTrackedPrice || goal.targetAmount || 0);
      const priceChange = previousPrice > 0 && currentPrice > 0 ? previousPrice - currentPrice : 0;
      const priceMoveText = priceChange > 0
        ? ` · ${calc.formatCurrency(priceChange)} price drop`
        : priceChange < 0
        ? ` · ${calc.formatCurrency(Math.abs(priceChange))} price increase`
        : '';
      const trackedTime = this._formatTrackedTime(goal.lastTrackedAt);
      const priceUpdate = isTracked && currentPrice > 0
        ? `<span class="tracked-price-change ${priceChange < 0 ? 'price-increase' : ''}">${calc.formatCurrency(currentPrice)} live${priceMoveText} · ${trackedTime}</span>`
        : isTracked
        ? '<span class="tracked-price-live">Live price tracking</span>'
        : '';
      const storeBadge = isShopping
        ? `<span class="store-badge">🛒 ${esc(storeName || 'Shopping')} · ${isTracked ? 'Live' : 'Manual'}</span>`
        : '';

      return `
        <div class="goal-card ${isTracked ? 'tracked-goal-card' : ''}" data-goal-id="${goal.id}">
          <div class="goal-card-inner">
            <div class="goal-card-header">
              <div class="goal-icon-title">
                ${isShopping && safeImage
                  ? `<img class="tracked-product-image" src="${esc(safeImage)}" alt="${esc(goal.itemName)}" loading="lazy">`
                  : `<div class="goal-emoji">${esc(goal.emoji || '🎯')}</div>`}
                <div class="goal-title-wrap">
                  <div class="goal-name">${esc(goal.itemName)}</div>
                  <div class="goal-category">${esc(goal.category || 'General')} • Target ${esc(goal.targetDate || '')}</div>
                  ${storeBadge}
                </div>
              </div>
              ${statusBadge}
            </div>

            ${priceUpdate ? `<div class="tracked-card-update">${priceUpdate}</div>` : ''}

            <div class="progress-container">
              <div class="progress-labels">
                <span>Saved ${calc.formatCurrency(goal.savedAmount)} of ${calc.formatCurrency(goal.targetAmount)}</span>
                <span class="progress-pct">${sched.progressPercentage}%</span>
              </div>
              <div class="progress-track">
                <div class="progress-fill" data-fill="${sched.progressPercentage}" style="width: 0%"></div>
              </div>
            </div>

            ${overpaid}

            <div class="goal-financials">
              <div>
                <div class="fin-item-label">SCHEDULED FLOW</div>
                <div class="fin-item-value highlight">${esc(sched.formattedPayment)}</div>
              </div>
              <div>
                <div class="fin-item-label">TIMELINE REMAINING</div>
                <div class="fin-item-value">${sched.remainingDays} days</div>
              </div>
            </div>
          </div>

          <div class="goal-actions">
            ${goal.status === 'active' ? `
              <button class="btn btn-emerald btn-full btn-deposit" data-goal-id="${goal.id}">
                ⚡ Deposit
              </button>
            ` : ''}
            ${isTracked ? `
              <button class="btn btn-secondary btn-refresh-price" data-goal-id="${goal.id}">⚡ Check Price</button>
            ` : ''}
            ${isShopping && this._safeExternalUrl(goal.product_url) ? `
              <a class="btn btn-secondary store-link" href="${esc(this._safeExternalUrl(goal.product_url))}" target="_blank" rel="noopener noreferrer">🔗 Store</a>
            ` : ''}
            <button class="btn btn-secondary btn-manage" data-goal-id="${goal.id}">
              ⚙️ Manage
            </button>
          </div>
        </div>
      `;
    }).join('');

    goalsGrid.querySelectorAll('.btn-deposit').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openPaymentSandbox(btn.getAttribute('data-goal-id'));
      });
    });

    goalsGrid.querySelectorAll('.btn-refresh-price').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.refreshTrackedVaultPrice(btn.getAttribute('data-goal-id'));
      });
    });

    goalsGrid.querySelectorAll('.btn-manage').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openGoalDetailModal(btn.getAttribute('data-goal-id'));
      });
    });

    goalsGrid.querySelectorAll('.goal-card').forEach((card, idx) => {
      card.classList.add('card-enter');
      card.style.animationDelay = `${Math.min(idx * 70, 420)}ms`;
    });
    requestAnimationFrame(() => {
      goalsGrid.querySelectorAll('.progress-fill').forEach((fill) => {
        const targetWidth = parseFloat(fill.getAttribute('data-fill')) || 0;
        setTimeout(() => { fill.style.width = targetWidth + '%'; }, 100);
      });
    });
  }

  static renderChart() {
    const goals = _storageSvc().getGoals();
    getTrajectoryChart().renderChart('trajectoryCanvas', goals);
  }

  // ===================== ANALYTICS (donut / velocity / health) =====================

  static _destroyCanvasInstance(registryName, canvasId) {
    try {
      const reg = typeof window !== 'undefined' ? window[registryName] : null;
      if (reg && reg._instances && reg._instances[canvasId]) {
        reg._instances[canvasId].destroy();
        delete reg._instances[canvasId];
      }
    } catch (e) {}
  }

  static renderAnalytics() {
    const goals = _storageSvc().getGoals();

    this._destroyCanvasInstance('CategoryDonutChart', 'donutCanvas');
    this._destroyCanvasInstance('MonthlyVelocityBarChart', 'velocityCanvas');
    this._destroyCanvasInstance('HealthScoreGauge', 'healthScoreCanvas');

    if (typeof window.CategoryDonutChart !== 'undefined') {
      window.CategoryDonutChart.renderChart('donutCanvas', goals, 'donutLegend');
    }
    if (typeof window.MonthlyVelocityBarChart !== 'undefined') {
      window.MonthlyVelocityBarChart.renderChart('velocityCanvas', goals);
    }
    if (typeof window.HealthScoreGauge !== 'undefined') {
      window.HealthScoreGauge.renderChart('healthScoreCanvas', goals, 'healthScoreDetail');
    }
  }

  // ===================== MODALS =====================

  static openModal(modalId) {
    if (typeof window.ModalManager !== 'undefined') {
      if (!window.ModalManager.open(modalId)) return;
    } else {
      const modal = document.getElementById(modalId);
      if (!modal) return;
      modal.classList.add('active');
    }
    if (modalId === 'pinModal') this.state.pinValue = '';
  }

  static closeModal(modalId) {
    if (typeof window.ModalManager !== 'undefined') {
      window.ModalManager.close(modalId);
    } else {
      const modal = document.getElementById(modalId);
      if (!modal) return;
      modal.classList.remove('active');
    }
    if (modalId === 'updateNewPinModal' && typeof window.cancelPinChange === 'function') {
      window.cancelPinChange();
    }
    if (modalId === 'pinModal') this.state.pinValue = '';
  }

  static closeTopModal() {
    if (typeof window.ModalManager !== 'undefined') {
      window.ModalManager.closeTop();
      return;
    }
    const open = Array.prototype.slice.call(document.querySelectorAll('.modal-overlay.active'));
    const top = open.pop();
    if (top) this.closeModal(top.id);
  }

  // ===================== WIZARD =====================

  static _getProductApiUrl() {
    const configured = window.SALVIS_API_URL;
    if (configured) return String(configured).replace(/\/$/, '') + '/api/scrape-product';
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    const hostname = window.location.hostname || 'localhost';
    return `${protocol}//${hostname}:8000/api/scrape-product`;
  }

  static _safeExternalUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch (e) {
      return '';
    }
  }

  static _formatTrackedTime(value) {
    if (!value) return 'Live';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Live';
    const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
    if (minutes < 1) return 'Live';
    if (minutes < 60) return `${minutes}m ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  static _getStoreName(url) {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
      if (hostname.includes('amazon')) return 'Amazon';
      if (hostname.includes('flipkart')) return 'Flipkart';
      if (hostname.includes('ebay')) return 'eBay';
      if (hostname.includes('walmart')) return 'Walmart';
      if (hostname.includes('etsy')) return 'Etsy';
      if (hostname.includes('myntra')) return 'Myntra';
      return hostname.split('.')[0].replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || 'Online Store';
    } catch (e) {
      return 'Online Store';
    }
  }

  static _syncCreationForm() {
    const read = (id) => {
      const element = document.getElementById(id);
      return element ? element.value.trim() : null;
    };
    const current = this.state.wizardData || {};
    this.state.wizardData = {
      ...current,
      itemName: read('createItemName') ?? current.itemName ?? '',
      store_name: read('createStoreName') ?? current.store_name ?? '',
      category: read('createCategory') ?? current.category ?? 'Shopping',
      targetAmount: parseFloat(read('createTargetAmount')) || 0,
      product_url: read('productUrlInput') ?? read('createProductUrl') ?? current.product_url ?? '',
      image_url: read('createImageUrl') ?? current.image_url ?? '',
      emoji: read('createEmoji') || current.emoji || '🎯',
      frequency: read('createFrequency') || current.frequency || 'weekly',
      targetDate: read('createTargetDate') || current.targetDate
    };
  }

  static setVaultType(type) {
    this._syncCreationForm();
    if (type === 'shopping' || type === 'url') {
      this.state.vaultType = 'shopping';
      if (type === 'url') this.state.shoppingMode = 'url';
    } else {
      this.state.vaultType = 'personal';
    }
    this.state.currentVaultType = this.state.vaultType === 'shopping' ? 'url' : 'standard';
    this.renderWizardStep();
  }

  static setShoppingMode(mode) {
    this._syncCreationForm();
    this.state.shoppingMode = mode === 'manual' ? 'manual' : 'url';
    this.renderWizardStep();
  }

  static _updateCreationCalculation() {
    const amount = parseFloat(document.getElementById('createTargetAmount')?.value) || 0;
    const frequency = document.getElementById('createFrequency')?.value || 'weekly';
    const targetDate = document.getElementById('createTargetDate')?.value;
    const startDate = this.state.wizardData?.startDate || new Date().toISOString().split('T')[0];
    const schedule = getSavingsCalculator().calculateSchedule(amount, 0, startDate, targetDate, frequency);
    const payment = document.getElementById('createCalcPayment');
    const sub = document.getElementById('createCalcSub');
    if (payment) payment.textContent = schedule.formattedPayment;
    if (sub) sub.textContent = `${schedule.remainingIntervals} ${schedule.frequencyLabel} payments over ${schedule.remainingDays} days`;
  }

  static _confirmManualProductPrice() {
    const targetAmount = parseFloat(document.getElementById('createTargetAmount')?.value) || 0;
    if (!(targetAmount > 0)) {
      this.showToast('Enter the price you want to track first', 'warning');
      return;
    }
    this.state.fetchedProductData = {
      ...(this.state.fetchedProductData || {}),
      is_captcha: false,
      manualFallback: true,
      price: targetAmount
    };
    this.state.wizardData = { ...this.state.wizardData, lastTrackedPrice: targetAmount };
    const previewPrice = document.getElementById('previewProductPrice');
    const button = document.getElementById('btnConfirmManualPrice');
    if (previewPrice) previewPrice.textContent = getSavingsCalculator().formatCurrency(targetAmount);
    button?.remove();
    this.showToast('Manual price confirmed; the product link is still being tracked');
  }

  static async fetchProductMetadata() {
    const urlInput = document.getElementById('productUrlInput');
    const fetchBtn = document.getElementById('btnFetchUrl');
    const url = urlInput?.value.trim() || '';
    if (!url || !/^https?:\/\//i.test(url)) {
      this.showToast('Please enter a valid product URL', 'warning');
      return;
    }
    this._syncCreationForm();

    const originalBtnText = fetchBtn?.textContent || 'Fetch Price';
    if (fetchBtn) {
      fetchBtn.disabled = true;
      fetchBtn.textContent = 'Scanning...';
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);

    try {
      const response = await fetch(this._getProductApiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Could not fetch product details');

      const price = parseFloat(data.price);
      const productData = {
        ...data,
        title: data.title || 'Tracked Product',
        price: Number.isFinite(price) && price > 0 ? price : 0,
        is_captcha: data.is_captcha === true,
        image_url: this._safeExternalUrl(data.image_url),
        store_name: data.store_name || this._getStoreName(url)
      };
      this.state.fetchedProductData = productData;
      this.state.wizardData = {
        ...this.state.wizardData,
        itemName: productData.title,
        category: ['Electronics', 'Travel', 'Gaming', 'Safety', 'Shopping'].includes(productData.category)
          ? productData.category
          : this.state.wizardData.category,
        product_url: url,
        store_name: productData.store_name,
        image_url: productData.image_url,
        lastTrackedPrice: productData.price,
        lastTrackedAt: new Date().toISOString()
      };

      const itemName = document.getElementById('createItemName') || document.getElementById('wizItemName');
      const targetAmount = document.getElementById('createTargetAmount') || document.getElementById('wizTargetAmount');
      const category = document.getElementById('createCategory') || document.getElementById('wizCategory');
      const image = document.getElementById('previewProductImg');
      const title = document.getElementById('previewProductTitle');
      const previewPrice = document.getElementById('previewProductPrice');
      const card = document.getElementById('productPreviewCard');
      if (itemName) itemName.value = productData.title;
      if (targetAmount && productData.price > 0) targetAmount.value = productData.price;
      if (category) category.value = this.state.wizardData.category;
      if (image) {
        image.src = productData.image_url || '';
        image.hidden = !productData.image_url;
      }
      if (title) title.textContent = productData.title;
      if (previewPrice) previewPrice.textContent = productData.is_captcha
        ? 'Live price protected — enter a target below'
        : productData.price > 0
        ? getSavingsCalculator().formatCurrency(productData.price)
        : 'Price unavailable';
      card?.classList.remove('hidden');
      if (productData.is_captcha) {
        this.showToast('Store anti-bot active. Enter target price manually to start tracking.', 'info');
      } else if (productData.price > 0) {
        this.showToast(`Found price: ${getSavingsCalculator().formatCurrency(productData.price)}`, 'success');
      }
      this._updateCreationCalculation();
    } catch (err) {
      clearTimeout(timeoutId);
      const isTimeout = err.name === 'AbortError' || (err.message && err.message.toLowerCase().includes('timed out'));
      const detectedStore = this._getStoreName(url);

      const itemName = document.getElementById('createItemName') || document.getElementById('wizItemName');
      const targetAmount = document.getElementById('createTargetAmount') || document.getElementById('wizTargetAmount');
      if (itemName && (!itemName.value.trim() || itemName.value === 'e.g. Sony WH-1000XM5')) {
        itemName.value = `${detectedStore} Product`;
      }
      if (targetAmount) targetAmount.focus();

      if (isTimeout) {
        this.showToast(`${detectedStore} scan timed out. Enter price manually below.`, 'warning');
      } else {
        this.showToast(err.message || 'Price scan unavailable. Enter price manually below.', 'warning');
      }
    } finally {
      clearTimeout(timeoutId);
      if (fetchBtn) {
        fetchBtn.disabled = false;
        fetchBtn.textContent = originalBtnText;
      }
    }
  }

  static _applyTrackedPrice(goal, data, price) {
    const previousPrice = parseFloat(goal.lastTrackedPrice || goal.previousTrackedPrice || 0) || price;
    const history = Array.isArray(goal.priceHistory) ? goal.priceHistory.slice() : [];
    const lastEntry = history[history.length - 1];
    if (!lastEntry || parseFloat(lastEntry.price) !== price) {
      history.push({ price, timestamp: new Date().toISOString() });
    }
    goal.previousTrackedPrice = previousPrice;
    goal.lastTrackedPrice = price;
    goal.lastTrackedAt = new Date().toISOString();
    goal.priceHistory = history.slice(-30);
    goal.image_url = this._safeExternalUrl(data.image_url) || goal.image_url || '';
    goal.store_name = data.store_name || goal.store_name || this._getStoreName(goal.product_url);
  }

  static async refreshTrackedVaultPrice(goalId) {
    const goal = _storageSvc().getGoalById(goalId);
    if (!goal || !goal.is_tracked || !goal.product_url) {
      this.showToast('This vault is not connected to a live product URL', 'warning');
      return;
    }
    const detailButton = document.getElementById('btnRefreshDetailPrice');
    if (detailButton) {
      detailButton.disabled = true;
      detailButton.textContent = 'Checking...';
    }
    const buttons = document.querySelectorAll('.btn-refresh-price');
    buttons.forEach((button) => {
      if (button.getAttribute('data-goal-id') === goalId) {
        button.disabled = true;
        button.textContent = 'Checking...';
      }
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);

    try {
      const response = await fetch(this._getProductApiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: goal.product_url }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const data = await response.json().catch(() => ({}));
      if (data.is_captcha) {
        this.showToast('The store is asking for verification; keeping your current price', 'warning');
        return;
      }
      const price = parseFloat(data.price);
      if (!response.ok || !Number.isFinite(price) || price <= 0) throw new Error('No live price found');
      const previous = parseFloat(goal.lastTrackedPrice || 0);
      this._applyTrackedPrice(goal, data, price);
      _storageSvc().saveGoal(goal);
      this.renderAll();
      if (this.state.selectedGoalForDetail?.id === goal.id) this.openGoalDetailModal(goal.id);
      const delta = previous - price;
      this.showToast(delta > 0 ? `🎉 Price dropped by ${getSavingsCalculator().formatCurrency(delta)}!` : delta < 0 ? `Price increased by ${getSavingsCalculator().formatCurrency(Math.abs(delta))}` : 'Live price is unchanged');
    } catch (e) {
      clearTimeout(timeoutId);
      this.showToast('Could not sync this product price right now', 'error');
    } finally {
      clearTimeout(timeoutId);
      buttons.forEach((button) => {
        if (button.getAttribute('data-goal-id') === goalId) {
          button.disabled = false;
          button.textContent = '⚡ Check Price';
        }
      });
      const currentDetailButton = document.getElementById('btnRefreshDetailPrice');
      if (currentDetailButton) {
        currentDetailButton.disabled = false;
        currentDetailButton.textContent = '⚡ Check Price';
      }
    }
  }

  static startTrackedVaultRefresh() {
    if (this.state.trackedVaultRefreshTimer) clearInterval(this.state.trackedVaultRefreshTimer);
    this._refreshTrackedVaults();
    this.state.trackedVaultRefreshTimer = setInterval(() => this._refreshTrackedVaults(), 30 * 60 * 1000);
  }

  static async _refreshTrackedVaults() {
    if (this.state.trackedVaultRefreshInFlight) return;
    const storage = _storageSvc();
    const tracked = storage.getGoals().filter((goal) => goal.is_tracked && goal.product_url);
    if (!tracked.length) return;

    this.state.trackedVaultRefreshInFlight = true;
    try {
      let changed = false;
      for (const goal of tracked) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        try {
          const response = await fetch(this._getProductApiUrl(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: goal.product_url }),
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          const data = await response.json().catch(() => ({}));
          const price = parseFloat(data.price);
          if (!response.ok || !Number.isFinite(price) || price <= 0) continue;
          const current = storage.getGoalById(goal.id);
          if (!current || current.product_url !== goal.product_url) continue;
          this._applyTrackedPrice(current, data, price);
          storage.saveGoal(current);
          changed = true;
        } catch (e) {
          clearTimeout(timeoutId);
        }
      }
      if (changed) this.renderAll();
    } finally {
      this.state.trackedVaultRefreshInFlight = false;
    }
  }

  static openCreateVaultModal() {
    const modal = document.getElementById('createVaultModal');
    if (!modal) return;
    const today = new Date().toISOString().split('T')[0];
    this.state.vaultType = 'personal';
    this.state.shoppingMode = 'url';
    this.state.currentVaultType = 'standard';
    this.state.fetchedProductData = null;
    this.state.wizardData = {
      emoji: '🎯',
      category: 'Safety',
      itemName: '',
      store_name: '',
      product_url: '',
      image_url: '',
      targetAmount: 1000,
      frequency: 'weekly',
      startDate: today,
      targetDate: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    };
    this.renderWizardStep();
    this.openModal('createVaultModal');
  }

  static openWizardModal() {
    return this.openCreateVaultModal();
  }

  static renderWizardStep() {
    const content = document.getElementById('createVaultContent');
    if (!content) return;
    const wd = this.state.wizardData;
    const isShopping = this.state.vaultType === 'shopping';
    const isTracked = isShopping && this.state.shoppingMode === 'url';
    const fetched = this.state.fetchedProductData;
    const safeImage = this._safeExternalUrl(wd.image_url);
    const categories = ['Safety', 'Travel', 'Education', 'Health', 'Investment', 'Shopping', 'Custom'];
    const presets = [
      { label: 'Emergency fund', amount: 10000, category: 'Safety', emoji: '🛡️' },
      { label: 'Travel', amount: 3500, category: 'Travel', emoji: '🌸' },
      { label: 'Education', amount: 12000, category: 'Education', emoji: '🎓' },
      { label: 'Car', amount: 25000, category: 'Investment', emoji: '🚗' }
    ];

    content.innerHTML = `
      <div class="create-studio-head">
        <h3 class="wizard-title">Create Smart Savings Vault</h3>
        <p class="create-studio-subtitle">Choose a goal and Salvis will keep your plan moving in real time.</p>
      </div>
      <div class="creation-mode-grid">
        <button type="button" class="creation-mode-card ${isShopping ? 'active' : ''}" data-creation-type="shopping">
          <span class="creation-mode-icon">🛍️</span><span><strong>Online Shopping</strong><small>Track a product or plan a manual purchase</small></span>
        </button>
        <button type="button" class="creation-mode-card ${!isShopping ? 'active' : ''}" data-creation-type="personal">
          <span class="creation-mode-icon">💰</span><span><strong>Personal Savings</strong><small>Build toward a life milestone</small></span>
        </button>
      </div>

      ${isShopping ? `
        <div class="shopping-mode-tabs" role="tablist">
          <button type="button" class="shopping-mode-tab ${isTracked ? 'active' : ''}" data-shopping-mode="url">🔗 Live URL Tracking</button>
          <button type="button" class="shopping-mode-tab ${!isTracked ? 'active' : ''}" data-shopping-mode="manual">✏️ Manual Price</button>
        </div>
      ` : ''}

      ${isTracked ? `
        <div class="creation-section url-container">
          <label class="form-label" for="productUrlInput">Product link</label>
          <div class="url-input-row">
            <input type="url" id="productUrlInput" class="form-input" placeholder="Paste Amazon, Flipkart, Myntra, or store link" value="${esc(wd.product_url)}">
            <button type="button" id="btnFetchUrl" class="btn btn-primary">Fetch Price</button>
          </div>
          <div id="productPreviewCard" class="product-preview-card ${fetched ? '' : 'hidden'}">
            <img id="previewProductImg" src="${esc(safeImage)}" alt="Product Preview" class="product-preview-image" ${safeImage ? '' : 'hidden'}>
            <div class="preview-info">
              <div id="previewProductTitle" class="preview-title">${esc(fetched?.title || wd.itemName || 'Product preview')}</div>
              <div class="preview-price">Detected: <span id="previewProductPrice">${fetched?.is_captcha ? 'Live price protected — enter a target below' : fetched?.price > 0 ? esc(getSavingsCalculator().formatCurrency(fetched.price)) : 'Fetch to detect live price'}</span></div>
              ${fetched?.store_name ? `<div class="preview-store">${esc(fetched.store_name)} · ${fetched.is_captcha ? 'manual fallback ready' : 'live tracking enabled'}</div>` : ''}
            </div>
            ${fetched?.is_captcha ? `<button type="button" id="btnConfirmManualPrice" class="btn btn-secondary btn-sm">Use entered target</button>` : ''}
          </div>
        </div>
      ` : ''}

      <div class="creation-section">
        <div class="form-group">
          <label class="form-label" for="createItemName">${isShopping ? 'Product title' : 'Goal title'}</label>
          <input type="text" id="createItemName" class="form-input" placeholder="${isShopping ? 'e.g. Sony WH-1000XM5' : 'e.g. Emergency Fund'}" value="${esc(wd.itemName)}">
        </div>
        <div class="form-row">
          ${isShopping && !isTracked ? `
            <div class="form-group">
              <label class="form-label" for="createStoreName">Store / platform</label>
              <input type="text" id="createStoreName" class="form-input" placeholder="Amazon, Croma, Offline Store" value="${esc(wd.store_name)}">
            </div>
          ` : ''}
          ${!isShopping ? `
            <div class="form-group">
              <label class="form-label" for="createCategory">Category</label>
              <select id="createCategory" class="form-select">
                ${categories.map((category) => `<option ${wd.category === category ? 'selected' : ''}>${category}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" for="createEmoji">Icon</label>
              <input type="text" id="createEmoji" class="form-input" maxlength="8" value="${esc(wd.emoji)}">
            </div>
          ` : ''}
          <div class="form-group">
            <label class="form-label" for="createTargetAmount">${isShopping ? 'Target price' : 'Target amount'}</label>
            <input type="number" id="createTargetAmount" class="form-input" min="0" step="0.01" value="${esc(wd.targetAmount)}">
          </div>
        </div>
        ${isShopping && !isTracked ? `
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="createProductUrl">Product link <span class="optional-label">Optional</span></label>
              <input type="url" id="createProductUrl" class="form-input" placeholder="https://..." value="${esc(wd.product_url)}">
            </div>
            <div class="form-group">
              <label class="form-label" for="createImageUrl">Reference image URL <span class="optional-label">Optional</span></label>
              <input type="url" id="createImageUrl" class="form-input" placeholder="https://..." value="${esc(wd.image_url)}">
            </div>
          </div>
        ` : ''}
        ${!isShopping ? `
          <div class="quick-preset-row">
            ${presets.map((preset) => `<button type="button" class="quick-preset" data-preset-label="${esc(preset.label)}" data-preset-amount="${preset.amount}" data-preset-category="${preset.category}" data-preset-emoji="${preset.emoji}">${preset.emoji} ${esc(preset.label)}</button>`).join('')}
          </div>
        ` : ''}
      </div>

      <div class="creation-section schedule-section">
        <div class="section-title-row"><div><h4>Savings schedule</h4><p>Adjust the cadence and date. Your payment updates instantly.</p></div><span class="live-chip">● LIVE CALCULATOR</span></div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="createFrequency">Saving interval</label>
            <select id="createFrequency" class="form-select">
              ${Object.keys(FREQUENCY_OPTIONS).map((key) => `<option value="${key}" ${wd.frequency === key ? 'selected' : ''}>${FREQUENCY_OPTIONS[key]}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="createTargetDate">Target completion date</label>
            <input type="date" id="createTargetDate" class="form-input" value="${esc(wd.targetDate)}">
          </div>
        </div>
        <div class="calc-panel inline-calc">
          <div class="calc-payment-label">RECURRING PAYMENT</div>
          <div class="calc-payment-value" id="createCalcPayment"></div>
          <div class="calc-payment-sub" id="createCalcSub"></div>
        </div>
      </div>
      <div class="wizard-nav creation-submit-row">
        <span class="tracking-note">${isTracked ? 'Price tracking runs every 30 minutes while Salvis is open.' : 'You can edit the target after creating the vault.'}</span>
        <button type="button" class="btn btn-primary" id="btnCreateVault">Confirm & Launch Vault 🚀</button>
      </div>
    `;

    content.querySelectorAll('[data-creation-type]').forEach((button) => button.addEventListener('click', () => this.setVaultType(button.dataset.creationType)));
    content.querySelectorAll('[data-shopping-mode]').forEach((button) => button.addEventListener('click', () => this.setShoppingMode(button.dataset.shoppingMode)));
    content.querySelector('#btnFetchUrl')?.addEventListener('click', () => this.fetchProductMetadata());
    content.querySelector('#btnConfirmManualPrice')?.addEventListener('click', () => this._confirmManualProductPrice());
    content.querySelectorAll('.quick-preset').forEach((button) => button.addEventListener('click', () => {
      this._syncCreationForm();
      this.state.wizardData = { ...this.state.wizardData, itemName: button.dataset.presetLabel, targetAmount: Number(button.dataset.presetAmount), category: button.dataset.presetCategory, emoji: button.dataset.presetEmoji };
      this.renderWizardStep();
    }));
    content.querySelectorAll('#createTargetAmount, #createFrequency, #createTargetDate').forEach((input) => {
      input.addEventListener('input', () => this._updateCreationCalculation());
      input.addEventListener('change', () => this._updateCreationCalculation());
    });
    content.querySelector('#btnCreateVault').addEventListener('click', () => this._createVaultFromStudio());
    this._updateCreationCalculation();
  }

  static async _createVaultFromStudio() {
    this._syncCreationForm();
    const wd = this.state.wizardData;
    const isShopping = this.state.vaultType === 'shopping';
    const isTracked = isShopping && this.state.shoppingMode === 'url';
    if (!wd.itemName || !(wd.targetAmount > 0)) {
      this.showToast('Add a title and a target amount first', 'warning');
      return;
    }
    if (isTracked && !/^https?:\/\//i.test(wd.product_url)) {
      this.showToast('Paste a valid product URL first', 'warning');
      return;
    }
    const user = getAuthService().getCurrentUser();
    const timestamp = new Date().toISOString();
    const trackedPrice = isTracked ? parseFloat(this.state.fetchedProductData?.price || wd.targetAmount) : 0;
    const newGoal = {
      id: 'goal-' + Date.now(),
      userId: user ? user.id : null,
      vaultType: isShopping ? 'shopping' : 'personal',
      shoppingMode: isShopping ? this.state.shoppingMode : null,
      track_mode: isShopping ? this.state.shoppingMode : null,
      itemName: wd.itemName,
      store_name: isShopping ? (wd.store_name || (isTracked ? this._getStoreName(wd.product_url) : '')) : '',
      category: isShopping ? 'Shopping' : wd.category,
      emoji: isShopping && isTracked ? '🛒' : (wd.emoji || (isShopping ? '🛍️' : '🎯')),
      product_url: isShopping ? wd.product_url : '',
      image_url: isShopping ? (this._safeExternalUrl(wd.image_url) || '') : '',
      targetAmount: wd.targetAmount,
      savedAmount: 0,
      is_tracked: isTracked,
      lastTrackedPrice: trackedPrice,
      previousTrackedPrice: trackedPrice,
      lastTrackedAt: isTracked ? timestamp : null,
      priceHistory: isTracked && trackedPrice > 0 ? [{ price: trackedPrice, timestamp }] : [],
      frequency: wd.frequency,
      startDate: wd.startDate,
      targetDate: wd.targetDate,
      status: 'active',
      createdAt: timestamp
    };
    _storageSvc().saveGoal(newGoal);
    this.closeModal('createVaultModal');
    this.renderAll();
    this.showToast(`🚀 Vault "${esc(newGoal.itemName)}" created!`);
  }

  static _openLegacyWizardModal() {
    const modal = document.getElementById('wizardModal');
    if (!modal) return;

    this.state.wizardStep = 1;
    this.state.currentVaultType = 'standard';
    this.state.fetchedProductData = null;
    this.state.wizardData = {
      emoji: '📱',
      category: 'Electronics',
      itemName: 'iPhone 16 Pro',
      targetAmount: 1299,
      frequency: 'weekly',
      startDate: new Date().toISOString().split('T')[0],
      targetDate: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      product_url: '',
      store_name: '',
      image_url: ''
    };

    this.renderWizardStep();
    this.openModal('wizardModal');
  }

  static _renderLegacyWizardStep() {
    const content = document.getElementById('wizardContent');
    if (!content) return;

    document.querySelectorAll('.wizard-step-node').forEach((node, idx) => {
      const stepNum = idx + 1;
      node.classList.remove('active', 'completed');
      if (stepNum === this.state.wizardStep) node.classList.add('active');
      else if (stepNum < this.state.wizardStep) node.classList.add('completed');
    });

    const wd = this.state.wizardData;

    if (this.state.wizardStep === 1) {
      content.innerHTML = `
        <h3 class="wizard-title">Step 1: Select Vault Target</h3>

        <div class="vault-type-selector form-group">
          <div class="form-label">Vault Type</div>
          <div class="vault-type-grid">
            <button type="button" id="btnTypeStandard" class="type-btn ${this.state.currentVaultType === 'standard' ? 'active' : ''}">
              <span>🏦</span> Standard Savings
            </button>
            <button type="button" id="btnTypeUrl" class="type-btn ${this.state.currentVaultType === 'url' ? 'active' : ''}">
              <span>🛒</span> Live Product URL
            </button>
          </div>
        </div>

        <div id="urlInputContainer" class="url-container form-group ${this.state.currentVaultType === 'url' ? '' : 'hidden'}">
          <label class="form-label" for="productUrlInput">Product Link (Amazon, Flipkart, etc.)</label>
          <div class="url-input-row">
            <input type="url" id="productUrlInput" class="form-input" placeholder="https://www.amazon.in/dp/..." value="${esc(wd.product_url || '')}">
            <button type="button" id="btnFetchUrl" class="btn btn-primary">Fetch Price</button>
          </div>
          <div id="productPreviewCard" class="product-preview-card ${this.state.fetchedProductData ? '' : 'hidden'}">
            <img id="previewProductImg" src="${esc(wd.image_url || '')}" alt="Product Preview" class="product-preview-image" ${wd.image_url ? '' : 'hidden'}>
            <div class="preview-info">
              <div id="previewProductTitle" class="preview-title">${esc(this.state.fetchedProductData?.title || wd.itemName)}</div>
              <div class="preview-price">Detected Price: <span id="previewProductPrice">${this.state.fetchedProductData?.price > 0 ? esc(getSavingsCalculator().formatCurrency(this.state.fetchedProductData.price)) : 'Scan a product to detect its price'}</span></div>
            </div>
          </div>
        </div>

        <div id="vaultPresetsContainer" class="${this.state.currentVaultType === 'url' ? 'hidden' : ''}">
          <div class="form-label">Vault Presets</div>
          <div class="preset-grid">
            <div class="preset-card ${wd.itemName.includes('iPhone') ? 'selected' : ''}" data-preset="iphone">
              <div class="preset-emoji">📱</div>
              <div class="preset-title">iPhone 16</div>
            </div>
            <div class="preset-card ${wd.itemName.includes('MacBook') ? 'selected' : ''}" data-preset="macbook">
              <div class="preset-emoji">💻</div>
              <div class="preset-title">MacBook Pro</div>
            </div>
            <div class="preset-card ${wd.itemName.includes('Japan') ? 'selected' : ''}" data-preset="travel">
              <div class="preset-emoji">🌸</div>
              <div class="preset-title">Japan Trip</div>
            </div>
            <div class="preset-card ${wd.itemName.includes('PS5') ? 'selected' : ''}" data-preset="ps5">
              <div class="preset-emoji">🎮</div>
              <div class="preset-title">PS5 Pro</div>
            </div>
            <div class="preset-card ${wd.itemName.includes('Reserve') ? 'selected' : ''}" data-preset="rainy">
              <div class="preset-emoji">🛡️</div>
              <div class="preset-title">Reserve Fund</div>
            </div>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="wizItemName">Vault Item Name</label>
          <input type="text" id="wizItemName" class="form-input" value="${esc(wd.itemName)}">
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="wizCategory">Category</label>
            <select id="wizCategory" class="form-select">
              <option ${wd.category === 'Electronics' ? 'selected' : ''}>Electronics</option>
              <option ${wd.category === 'Travel' ? 'selected' : ''}>Travel</option>
              <option ${wd.category === 'Gaming' ? 'selected' : ''}>Gaming</option>
              <option ${wd.category === 'Safety' ? 'selected' : ''}>Safety</option>
              <option ${wd.category === 'Shopping' ? 'selected' : ''}>Shopping</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label" for="wizTargetAmount">Target Amount</label>
            <input type="number" id="wizTargetAmount" class="form-input" value="${wd.targetAmount}">
          </div>
        </div>

        <div class="wizard-nav">
          <button class="btn btn-primary" id="wizNextBtn1">Next: Schedule & Calculator ➡️</button>
        </div>
      `;

      content.querySelector('#btnTypeStandard').addEventListener('click', () => this.setVaultType('standard'));
      content.querySelector('#btnTypeUrl').addEventListener('click', () => this.setVaultType('url'));
      content.querySelector('#btnFetchUrl').addEventListener('click', () => this.fetchProductMetadata());
      content.querySelectorAll('.preset-card').forEach((card) => {
        card.addEventListener('click', () => {
          const type = card.getAttribute('data-preset');
          if (type === 'iphone') this.state.wizardData = { ...this.state.wizardData, emoji: '📱', category: 'Electronics', itemName: 'iPhone 16 Pro', targetAmount: 1299 };
          else if (type === 'macbook') this.state.wizardData = { ...this.state.wizardData, emoji: '💻', category: 'Electronics', itemName: 'MacBook Pro M3', targetAmount: 1999 };
          else if (type === 'travel') this.state.wizardData = { ...this.state.wizardData, emoji: '🌸', category: 'Travel', itemName: 'Japan Autumn Vacation', targetAmount: 3500 };
          else if (type === 'ps5') this.state.wizardData = { ...this.state.wizardData, emoji: '🎮', category: 'Gaming', itemName: 'PS5 Pro Console', targetAmount: 699 };
          else if (type === 'rainy') this.state.wizardData = { ...this.state.wizardData, emoji: '🛡️', category: 'Safety', itemName: 'Emergency Reserve Fund', targetAmount: 3000 };
          this.renderWizardStep();
        });
      });

      content.querySelector('#wizNextBtn1').addEventListener('click', () => {
        this.state.wizardData.itemName = document.getElementById('wizItemName').value.trim();
        this.state.wizardData.category = document.getElementById('wizCategory').value;
        this.state.wizardData.targetAmount = parseFloat(document.getElementById('wizTargetAmount').value) || 0;
        this.state.wizardData.product_url = document.getElementById('productUrlInput').value.trim();
        this.state.wizardData.store_name = this.state.fetchedProductData?.store_name || this._getStoreName(this.state.wizardData.product_url);
        if (this.state.currentVaultType === 'url' && !/^https?:\/\//i.test(this.state.wizardData.product_url)) {
          this.showToast('Enter a product URL before continuing', 'warning');
          return;
        }
        this.state.wizardStep = 2;
        this.renderWizardStep();
      });

    } else if (this.state.wizardStep === 2) {
      const sched = getSavingsCalculator().calculateSchedule(
        wd.targetAmount, 0, wd.startDate, wd.targetDate, wd.frequency
      );

      content.innerHTML = `
        <h3 class="wizard-title">Step 2: Dynamic Schedule Calculator</h3>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Saving Interval</label>
            <select id="wizFrequency" class="form-select">
              ${Object.keys(FREQUENCY_OPTIONS).map((k) =>
                `<option value="${k}" ${wd.frequency === k ? 'selected' : ''}>${FREQUENCY_OPTIONS[k]}</option>`
              ).join('')}
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">Target Completion Date</label>
            <input type="date" id="wizTargetDate" class="form-input" value="${esc(wd.targetDate)}">
          </div>
        </div>

        <div class="calc-panel">
          <div class="calc-payment-label">DYNAMIC CALCULATED RECURRING PAYMENT</div>
          <div class="calc-payment-value" id="wizCalcPayment">${esc(sched.formattedPayment)}</div>
          <div class="calc-payment-sub" id="wizCalcSub">${sched.remainingIntervals} periodic payments over ${sched.remainingDays} days</div>
        </div>

        <div class="wizard-nav spread">
          <button class="btn btn-secondary" id="wizBackBtn2">⬅️ Back</button>
          <button class="btn btn-primary" id="wizNextBtn2">Confirm & Create Vault 🚀</button>
        </div>
      `;

      const updateCalc = () => {
        const freq = document.getElementById('wizFrequency').value;
        const targetDate = document.getElementById('wizTargetDate').value;
        this.state.wizardData.frequency = freq;
        this.state.wizardData.targetDate = targetDate;

        const newSched = getSavingsCalculator().calculateSchedule(
          this.state.wizardData.targetAmount, 0, this.state.wizardData.startDate, targetDate, freq
        );
        document.getElementById('wizCalcPayment').textContent = newSched.formattedPayment;
        document.getElementById('wizCalcSub').textContent = `${newSched.remainingIntervals} periodic payments over ${newSched.remainingDays} days`;
      };

      document.getElementById('wizFrequency').addEventListener('change', updateCalc);
      document.getElementById('wizTargetDate').addEventListener('change', updateCalc);

      document.getElementById('wizBackBtn2').addEventListener('click', () => {
        this.state.wizardStep = 1;
        this.renderWizardStep();
      });

      document.getElementById('wizNextBtn2').addEventListener('click', () => {
        const user = getAuthService().getCurrentUser();
        if (!this.state.wizardData.targetAmount || this.state.wizardData.targetAmount <= 0) {
          this.showToast('Please enter a valid target amount 💰', 'warning');
          return;
        }
        const isTracked = this.state.currentVaultType === 'url';
        const newGoal = {
          id: 'goal-' + Date.now(),
          userId: user ? user.id : null,
          itemName: this.state.wizardData.itemName || 'Savings Vault',
          category: this.state.wizardData.category,
          emoji: isTracked ? '🛒' : this.state.wizardData.emoji,
          targetAmount: this.state.wizardData.targetAmount,
          savedAmount: 0,
          frequency: this.state.wizardData.frequency,
          startDate: this.state.wizardData.startDate,
          targetDate: this.state.wizardData.targetDate,
          status: 'active',
          is_tracked: isTracked,
          product_url: isTracked ? this.state.wizardData.product_url : '',
          store_name: isTracked ? this.state.wizardData.store_name : '',
          image_url: isTracked ? this.state.wizardData.image_url : '',
          lastTrackedPrice: isTracked ? this.state.wizardData.lastTrackedPrice || this.state.wizardData.targetAmount : 0,
          previousTrackedPrice: isTracked ? this.state.wizardData.lastTrackedPrice || this.state.wizardData.targetAmount : 0,
          lastTrackedAt: isTracked ? new Date().toISOString() : null,
          createdAt: new Date().toISOString()
        };

        _storageSvc().saveGoal(newGoal);
        this.closeModal('wizardModal');
        this.renderAll();
        this.showToast(`🎯 Savings Vault "${esc(newGoal.itemName)}" created!`);
      });
    }
  }

  // ===================== GOAL DETAIL =====================

  static openGoalDetailModal(goalId) {
    const goal = _storageSvc().getGoalById(goalId);
    if (!goal) return;

    this.state.selectedGoalForDetail = goal;
    const modal = document.getElementById('goalDetailModal');
    if (!modal) return;

    const sched = getSavingsCalculator().calculateSchedule(
      goal.targetAmount, goal.savedAmount, goal.startDate, goal.targetDate, goal.frequency
    );
    const calc = getSavingsCalculator();
    const body = document.getElementById('goalDetailBody');

    body.innerHTML = `
      <div class="goal-detail-hero">
        <div class="goal-detail-emoji">${esc(goal.emoji || '🎯')}</div>
        <div>
          <h2>${esc(goal.itemName)}</h2>
          <p>Target completion: ${esc(goal.targetDate || '—')} • ${esc(FREQUENCY_OPTIONS[goal.frequency] || goal.frequency)}</p>
        </div>
        <span class="badge ${goal.status === 'active' ? 'badge-active' : goal.status === 'paused' ? 'badge-paused' : 'badge-completed'}">
          ${goal.status === 'paused' ? 'Paused' : goal.status === 'completed' ? 'Completed' : 'Active'}
        </span>
      </div>

      <div class="goal-financials">
        <div>
          <div class="fin-item-label">SAVED vs TARGET</div>
          <div class="fin-item-value">${calc.formatCurrency(goal.savedAmount)} / ${calc.formatCurrency(goal.targetAmount)}</div>
        </div>
        <div>
          <div class="fin-item-label">SCHEDULED RECURRING</div>
          <div class="fin-item-value highlight">${esc(sched.formattedPayment)}</div>
        </div>
      </div>

      ${sched.projectedCompletionLabel !== '—'
        ? `<div class="info-line">⏳ Projected completion at current pace: <strong>${esc(sched.projectedCompletionLabel)}</strong></div>`
        : ''}
      ${sched.isOverpaid
        ? `<div class="overpaid-banner">⚠️ Overpaid by ${calc.formatCurrency(sched.surplus)}</div>`
        : ''}

      ${goal.is_tracked ? `
        <div class="tracked-detail-panel">
          <div class="tracked-detail-head">
            <div>
              <div class="fin-item-label">LIVE PRODUCT PRICE</div>
              <div class="tracked-detail-price">${calc.formatCurrency(goal.lastTrackedPrice || goal.targetAmount)}</div>
              <div class="tracked-detail-store">${esc(goal.store_name || this._getStoreName(goal.product_url))} · Updated ${this._formatTrackedTime(goal.lastTrackedAt)}</div>
            </div>
            <button class="btn btn-secondary btn-sm" id="btnRefreshDetailPrice">⚡ Check Price</button>
          </div>
          <div class="price-history">
            <div class="fin-item-label">RECENT PRICE HISTORY</div>
            ${(Array.isArray(goal.priceHistory) ? goal.priceHistory.slice(-6).reverse() : []).map((entry) => `<div class="price-history-row"><span>${calc.formatCurrency(entry.price)}</span><span>${esc(new Date(entry.timestamp).toLocaleString())}</span></div>`).join('') || '<div class="price-history-empty">Sync the product to start tracking price changes.</div>'}
          </div>
          <button type="button" class="btn btn-secondary btn-full btn-sm" id="btnDisableUrlTracking">Use manual target instead</button>
        </div>
      ` : ''}

      <div class="price-shift-box">
        <label class="form-label">Live Product Target Price Shift Simulator</label>
        <div class="price-shift-row">
          <input type="number" id="detailPriceInput" class="form-input" value="${goal.targetAmount}">
          <button class="btn btn-secondary btn-sm" id="btnUpdateTargetPrice">Update Price</button>
        </div>
      </div>

      <div class="detail-actions-row">
        ${goal.status === 'active' ? `
          <button class="btn btn-secondary btn-full" id="btnPauseGoal">⏸️ Pause Savings</button>
        ` : `
          <button class="btn btn-primary btn-full" id="btnResumeGoal">▶️ Resume Savings</button>
        `}
      </div>

      <div class="detail-edit-row">
        <button class="btn btn-secondary btn-full" id="btnEditGoal">✏️ Edit Vault</button>
        <button class="btn btn-danger btn-full" id="btnDeleteGoal">🗑️ Delete Vault</button>
      </div>

      <div class="pin-protected-box">
        <div class="pin-protected-head">
          <h4>🔒 PIN Protected Early Withdrawal</h4>
          <span class="pin-required-tag">PIN Required</span>
        </div>
        <p>Accumulated balance of <strong>${calc.formatCurrency(goal.savedAmount)}</strong> can be returned to your main wallet balance or reallocated to another active vault.</p>

        <div class="detail-actions-row">
          <button class="btn btn-danger btn-full" id="btnWithdrawToWallet">💵 Withdraw to Wallet</button>
          <button class="btn btn-secondary btn-full" id="btnReallocateGoal">🔄 Reallocate Vault</button>
        </div>
      </div>
    `;

    document.getElementById('btnRefreshDetailPrice')?.addEventListener('click', () => this.refreshTrackedVaultPrice(goal.id));
    document.getElementById('btnDisableUrlTracking')?.addEventListener('click', () => {
      goal.is_tracked = false;
      goal.track_mode = 'manual';
      _storageSvc().saveGoal(goal);
      this.renderAll();
      this.openGoalDetailModal(goal.id);
      this.showToast('URL tracking disabled; manual target mode enabled', 'warning');
    });

    document.getElementById('btnUpdateTargetPrice')?.addEventListener('click', () => {
      const newPrice = parseFloat(document.getElementById('detailPriceInput').value);
      if (newPrice > 0) {
        goal.targetAmount = newPrice;
        _storageSvc().saveGoal(goal);
        this.renderAll();
        this.openGoalDetailModal(goal.id);
        this.showToast(`Updated target price to ${calc.formatCurrency(newPrice)}`);
      }
    });

    document.getElementById('btnPauseGoal')?.addEventListener('click', () => {
      _storageSvc().updateGoalStatus(goal.id, 'paused');
      this.renderAll();
      this.closeModal('goalDetailModal');
      this.showToast(`Vault paused`);
    });

    document.getElementById('btnResumeGoal')?.addEventListener('click', () => {
      _storageSvc().updateGoalStatus(goal.id, 'active');
      this.renderAll();
      this.closeModal('goalDetailModal');
      this.showToast(`Vault resumed`);
    });

    document.getElementById('btnEditGoal')?.addEventListener('click', () => {
      this.closeModal('goalDetailModal');
      this.openEditGoalModal(goal);
    });

    document.getElementById('btnDeleteGoal')?.addEventListener('click', () => {
      this.confirmAction(
        `Delete the "${goal.itemName}" vault? Its ${calc.formatCurrency(goal.savedAmount)} balance will be returned to your wallet.`,
        () => {
          if (goal.savedAmount > 0) _storageSvc().updateWalletBalance(goal.savedAmount);
          _storageSvc().deleteOrCancelGoal(goal.id);
          this.renderAll();
          this.closeModal('goalDetailModal');
          this.showToast(`Vault "${esc(goal.itemName)}" deleted`, 'warning');
        }
      );
    });

    document.getElementById('btnWithdrawToWallet')?.addEventListener('click', () => {
      this.requestPinAuthorization(async () => {
        let tx = null;
        if (goal.savedAmount > 0) {
          _storageSvc().updateWalletBalance(goal.savedAmount);
          tx = _storageSvc().recordTransaction({
            goalId: goal.id,
            goalName: goal.itemName,
            amount: goal.savedAmount,
            type: 'withdrawal',
            method: 'Early Withdrawal',
            rail: 'wallet',
            balanceAfter: 0
          });
        }
        _storageSvc().deleteOrCancelGoal(goal.id);
        this.renderAll();
        this.closeModal('goalDetailModal');
        this.showToast(`Withdrew ${calc.formatCurrency(goal.savedAmount)} to wallet`, 'warning');
        if (tx) {
          this.state.lastReceiptTx = tx;
          setTimeout(() => this.openReceiptModal(tx.id), 350);
        }
      });
    });

    document.getElementById('btnReallocateGoal')?.addEventListener('click', () => {
      this.requestPinAuthorization(() => {
        this.openReallocateModal(goal);
      });
    });

    modal.classList.add('active');
  }

  // ===================== EDIT GOAL =====================

  static openEditGoalModal(goal) {
    const modal = document.getElementById('editGoalModal');
    if (!modal) return;

    document.getElementById('editGoalBody').innerHTML = `
      <div class="form-group">
        <label class="form-label">Vault Name</label>
        <input type="text" id="editGoalName" class="form-input" value="${esc(goal.itemName)}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Category</label>
          <select id="editGoalCategory" class="form-select">
            ${['Electronics', 'Travel', 'Gaming', 'Safety', 'Shopping'].map((c) =>
              `<option ${goal.category === c ? 'selected' : ''}>${c}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Emoji</label>
          <input type="text" id="editGoalEmoji" class="form-input" value="${esc(goal.emoji || '🎯')}" maxlength="8">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Target Amount</label>
          <input type="number" id="editGoalTarget" class="form-input" value="${goal.targetAmount}">
        </div>
        <div class="form-group">
          <label class="form-label">Frequency</label>
          <select id="editGoalFrequency" class="form-select">
            ${Object.keys(FREQUENCY_OPTIONS).map((k) =>
              `<option value="${k}" ${goal.frequency === k ? 'selected' : ''}>${FREQUENCY_OPTIONS[k]}</option>`
            ).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Target Date</label>
        <input type="date" id="editGoalDate" class="form-input" value="${esc(goal.targetDate || '')}">
      </div>
      <div class="detail-edit-row">
        <button class="btn btn-secondary btn-full" id="btnCancelEditGoal">Cancel</button>
        <button class="btn btn-emerald btn-full" id="btnSaveEditGoal">💾 Save Changes</button>
      </div>
    `;

    document.getElementById('btnCancelEditGoal').addEventListener('click', () => {
      this.closeModal('editGoalModal');
      this.openGoalDetailModal(goal.id);
    });

    document.getElementById('btnSaveEditGoal').addEventListener('click', () => {
      const edited = _storageSvc().getGoalById(goal.id);
      if (!edited) return;
      edited.itemName = document.getElementById('editGoalName').value.trim() || edited.itemName;
      edited.category = document.getElementById('editGoalCategory').value;
      edited.emoji = document.getElementById('editGoalEmoji').value.trim() || '🎯';
      edited.targetAmount = parseFloat(document.getElementById('editGoalTarget').value) || edited.targetAmount;
      edited.frequency = document.getElementById('editGoalFrequency').value;
      edited.targetDate = document.getElementById('editGoalDate').value || edited.targetDate;
      if (edited.savedAmount >= edited.targetAmount) edited.status = 'completed';

      _storageSvc().saveGoal(edited);
      this.closeModal('editGoalModal');
      this.renderAll();
      this.showToast('Vault updated 💾');
    });

    modal.classList.add('active');
  }

  // ===================== REALLOCATE =====================

  static openReallocateModal(sourceGoal) {
    const goals = _storageSvc().getGoals().filter((g) => g.id !== sourceGoal.id && g.status === 'active');
    if (goals.length === 0) {
      this.showToast('No other active vaults available for reallocation!', 'error');
      return;
    }

    const modal = document.getElementById('reallocateModal');
    if (!modal) return;

    const selectEl = document.getElementById('reallocateTargetSelect');
    selectEl.innerHTML = goals.map((g) =>
      `<option value="${g.id}">${esc(g.emoji)} ${esc(g.itemName)} (Saved ${getSavingsCalculator().formatCurrency(g.savedAmount)})</option>`
    ).join('');

    document.getElementById('reallocateSourceAmount').textContent = getSavingsCalculator().formatCurrency(sourceGoal.savedAmount);

    document.getElementById('btnConfirmReallocate').onclick = () => {
      const targetId = selectEl.value;
      const targetGoal = _storageSvc().getGoalById(targetId);
      if (!targetGoal) return;

      targetGoal.savedAmount += sourceGoal.savedAmount;
      if (targetGoal.savedAmount >= targetGoal.targetAmount) targetGoal.status = 'completed';
      _storageSvc().saveGoal(targetGoal);

      const tx = _storageSvc().recordTransaction({
        goalId: targetGoal.id,
        goalName: `Reallocated: ${sourceGoal.itemName} -> ${targetGoal.itemName}`,
        amount: sourceGoal.savedAmount,
        type: 'reallocate',
        method: 'Vault Transfer',
        rail: 'vault-transfer',
        balanceAfter: targetGoal.savedAmount
      });

      const notif = getNotifications();
      if (notif && notif.checkMilestones) {
        try { notif.checkMilestones(targetGoal); } catch (e) {}
      }

      _storageSvc().deleteOrCancelGoal(sourceGoal.id);
      this.renderAll();
      this.closeModal('reallocateModal');
      this.closeModal('goalDetailModal');
      this.showToast(`Reallocated ${getSavingsCalculator().formatCurrency(sourceGoal.savedAmount)} to ${esc(targetGoal.itemName)}! 🎉`);
      if (tx) {
        this.state.lastReceiptTx = tx;
        setTimeout(() => this.openReceiptModal(tx.id), 350);
      }
    };

    modal.classList.add('active');
  }

  // ===================== PAYMENT =====================

  static openPaymentSandbox(goalId) {
    const goal = _storageSvc().getGoalById(goalId);
    if (!goal) return;

    this.state.selectedGoalForPayment = goal;
    const modal = document.getElementById('paymentModal');
    if (!modal) return;

    const sched = getSavingsCalculator().calculateSchedule(
      goal.targetAmount, goal.savedAmount, goal.startDate, goal.targetDate, goal.frequency
    );

    document.getElementById('payGoalName').textContent = goal.itemName;
    const currency = getSavingsCalculator().getActiveUserCurrency();
    const payAmountLabel = document.getElementById('payAmountLabel');
    if (payAmountLabel) payAmountLabel.textContent = `Deposit Amount (${currency.code || 'local currency'})`;
    document.getElementById('payAmountInput').value = sched.paymentPerInterval || 1;
    this._resetPaymentUI();

    document.getElementById('btnExecutePayment').onclick = () => this._beginPaymentSimulation(goal);

    modal.classList.add('active');
  }

  static _delay(ms) {
    return new Promise((res) => setTimeout(res, ms));
  }

  static _detectPaymentRail(method) {
    const m = String(method || '').toLowerCase();
    if (m.indexOf('upi') !== -1) return 'upi';
    if (m.indexOf('card') !== -1) return 'card';
    if (m.indexOf('wallet') !== -1 || m.indexOf('ledger') !== -1) return 'wallet';
    return 'netbank';
  }

  static _setPaymentStatus(html, cls) {
    const area = document.getElementById('payStatusArea');
    if (!area) return;
    area.innerHTML = html;
    area.className = 'pay-status ' + (cls || '');
    area.style.display = 'flex';
  }

  static _resetPaymentUI() {
    const area = document.getElementById('payStatusArea');
    if (area) {
      area.style.display = 'none';
      area.innerHTML = '';
      area.className = 'pay-status';
    }
    const btn = document.getElementById('btnExecutePayment');
    if (btn) btn.disabled = false;
  }

  static async _beginPaymentSimulation(goal) {
    const amount = parseFloat(document.getElementById('payAmountInput')?.value) || 0;
    const methodEl = document.getElementById('payMethodSelect');
    const method = methodEl ? methodEl.value : 'Direct Net Banking Transfer';
    const btn = document.getElementById('btnExecutePayment');

    if (!(amount > 0)) {
      this.showToast('Please enter a valid deposit amount 💰', 'warning');
      return;
    }
    if (btn) btn.disabled = true;

    const rail = this._detectPaymentRail(method);
    this._setPaymentStatus(
      `<div class="pay-spinner"></div><div class="pay-status-text">Initiating ${esc(method)} — 700ms processing latency…</div>`,
      'processing'
    );

    try {
      await this._delay(700);
      if (rail === 'upi') return await this._upiRailFlow(goal, amount, method);
      if (rail === 'card') return await this._cardRailFlow(goal, amount, method);
      if (rail === 'wallet') return await this._walletRailFlow(goal, amount, method);
      return await this._directRailFlow(goal, amount, method);
    } catch (err) {
      this._resetPaymentUI();
    }
  }

  static async _upiRailFlow(goal, amount, method) {
    const seed = `salvis://upi?amount=${amount.toFixed(2)}&vault=${encodeURIComponent(goal.itemName)}&t=${Date.now()}`;
    this._setPaymentStatus(`
      <div class="upi-qr-head">📲 Simulated UPI QR — Scan & Pay</div>
      <canvas id="upiQrCanvas" class="upi-qr-canvas"></canvas>
      <div class="upi-qr-meta"><strong>${getSavingsCalculator().formatCurrency(amount)}</strong> to <span>salvis@upi</span></div>
      <div class="pay-status-text">Waiting for UPI confirmation…</div>
    `, 'qr');
    await this._delay(60);
    const qrCanvas = document.getElementById('upiQrCanvas');
    if (qrCanvas) this._drawSimulatedQR(qrCanvas, seed);
    await this._delay(1800);
    this._setPaymentStatus('<div class="pay-spinner done"></div><div class="pay-status-text">UPI payment confirmed ✓</div>', 'success');
    await this._delay(450);
    this._finalizePayment(goal, amount, method, { rail: 'upi' });
  }

  static async _cardRailFlow(goal, amount, method) {
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    this._setPaymentStatus(
      `<div class="pay-spinner"></div><div class="pay-status-text">Redirecting to ${esc(method)} 3D Secure…</div>`,
      'processing'
    );
    await this._delay(900);
    const accepted = await this._requestCardOtp(otp);
    if (!accepted) throw new Error('card-auth-cancelled');
    this._setPaymentStatus('<div class="pay-spinner done"></div><div class="pay-status-text">3D Secure verified — Card charged ✓</div>', 'success');
    await this._delay(450);
    this._finalizePayment(goal, amount, method, { rail: 'card' });
  }

  static _requestCardOtp(otp) {
    return new Promise((resolve) => {
      const modal = document.getElementById('otpModal');
      if (!modal) { resolve(true); return; }
      const input = document.getElementById('otpInput');
      const hint = document.getElementById('otpDemoHint');
      if (hint) hint.textContent = 'Demo OTP: ' + otp;
      if (input) { input.value = ''; input.focus(); }
      this.state.pendingOtp = { otp, resolve, settled: false };

      const watcher = new MutationObserver(() => {
        if (watcher && !modal.classList.contains('active')) {
          watcher.disconnect();
          const pending = this.state.pendingOtp;
          if (pending && !pending.settled) {
            pending.settled = true;
            pending.resolve(false);
          }
          this.state.pendingOtp = null;
        }
      });
      watcher.observe(modal, { attributes: true, attributeFilter: ['class'] });

      if (typeof window.ModalManager !== 'undefined') window.ModalManager.open('otpModal');
      else modal.classList.add('active');
    });
  }

  static verifyCardOtp() {
    const pending = this.state.pendingOtp;
    if (!pending) return;
    const input = document.getElementById('otpInput');
    const val = input ? input.value.trim() : '';
    if (val === pending.otp) {
      pending.settled = true;
      pending.resolve(true);
      this.state.pendingOtp = null;
      this.closeModal('otpModal');
    } else {
      this.showToast('Incorrect OTP. Check the demo OTP shown in the modal 📲', 'error');
      if (input) { input.value = ''; input.focus(); }
    }
  }

  static cancelOtpPrompt() {
    const pending = this.state.pendingOtp;
    if (pending && !pending.settled) {
      pending.settled = true;
      pending.resolve(false);
    }
    this.state.pendingOtp = null;
    this.closeModal('otpModal');
    this._resetPaymentUI();
  }

  static async _walletRailFlow(goal, amount, method) {
    const storage = _storageSvc();
    const balance = storage.getWalletBalance();
    if (balance < amount) {
      this._setPaymentStatus(
        `<div class="pay-status-error">❌ Insufficient Wallet Balance</div>` +
        `<div class="pay-status-text">Your ledger has ${getSavingsCalculator().formatCurrency(balance)} — you need ${getSavingsCalculator().formatCurrency(amount)}. Top up or pick another rail.</div>`,
        'error'
      );
      this.showToast('Insufficient wallet balance for this deposit ❌', 'error');
      await this._delay(2000);
      throw new Error('insufficient-wallet');
    }
    this._setPaymentStatus('<div class="pay-spinner"></div><div class="pay-status-text">Deducting from Primary Wallet Ledger…</div>', 'processing');
    await this._delay(800);
    storage.updateWalletBalance(-amount);
    this._setPaymentStatus('<div class="pay-spinner done"></div><div class="pay-status-text">Wallet debit confirmed ✓ Balance updated</div>', 'success');
    await this._delay(450);
    this._finalizePayment(goal, amount, method, { rail: 'wallet' });
  }

  static async _directRailFlow(goal, amount, method) {
    await this._delay(1100);
    this._setPaymentStatus(`<div class="pay-spinner done"></div><div class="pay-status-text">Transfer completed via ${esc(method)} ✓</div>`, 'success');
    await this._delay(400);
    this._finalizePayment(goal, amount, method, { rail: 'netbank' });
  }

  static _drawSimulatedQR(canvas, seed) {
    const ctx = canvas.getContext('2d');
    const target = 200;
    canvas.width = target;
    canvas.height = target;
    ctx.clearRect(0, 0, target, target);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, target, target);

    const cells = 25;
    const cell = target / cells;

    let h = 0;
    const s = String(seed || '');
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    let state = Math.abs(h) || 1;
    const rand = () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };

    ctx.fillStyle = '#0f172a';
    for (let r = 0; r < cells; r++) {
      for (let c = 0; c < cells; c++) {
        if (rand() < 0.42) ctx.fillRect(c * cell, r * cell, cell, cell);
      }
    }

    const drawFinder = (x, y) => {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(x * cell, y * cell, 7 * cell, 7 * cell);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect((x + 1) * cell, (y + 1) * cell, 5 * cell, 5 * cell);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect((x + 2) * cell, (y + 2) * cell, 3 * cell, 3 * cell);
    };
    drawFinder(0, 0);
    drawFinder(cells - 7, 0);
    drawFinder(0, cells - 7);
  }

  static _finalizePayment(goal, amount, method, opts = {}) {
    const storage = _storageSvc();
    goal.savedAmount = parseFloat((goal.savedAmount || 0)) + amount;
    const completed = goal.savedAmount >= goal.targetAmount;
    if (completed) goal.status = 'completed';
    storage.saveGoal(goal);

    const tx = storage.recordTransaction({
      goalId: goal.id,
      goalName: goal.itemName,
      amount,
      type: 'deposit',
      method,
      rail: opts.rail || 'direct',
      balanceAfter: goal.savedAmount
    });

    const notif = getNotifications();
    let hit100 = false;
    if (notif && notif.checkMilestones) {
      try { hit100 = notif.checkMilestones(goal); } catch (e) {}
    }

    if (typeof window.ModalManager !== 'undefined') window.ModalManager.close('paymentModal');
    else this.closeModal('paymentModal');
    if (typeof window.ModalManager !== 'undefined') window.ModalManager.close('otpModal');
    else this.closeModal('otpModal');
    this._resetPaymentUI();

    this.state.lastReceiptTx = tx;
    this.renderAll();
    this.showToast(`⚡ ${getSavingsCalculator().formatCurrency(amount)} deposited to "${esc(goal.itemName)}" via ${esc(method)}!`);

    setTimeout(() => {
      try {
        this.openReceiptModal(tx.id);
        if (completed || hit100) this.celebrateCompletion(goal.itemName);
      } catch (e) {}
    }, 350);
  }

  // ===================== DIGITAL RECEIPTS =====================

  static getTransactionById(txId) {
    if (!txId) return null;
    return _storageSvc().getTransactions().find((t) => t.id === txId) || null;
  }

  static _receiptReference(tx) {
    if (tx.reference) return tx.reference;
    const seed = String(tx.id || '');
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
    return 'SAL' + String(Math.abs(h) % 100000).padStart(5, '0');
  }

  static _receiptHTML(tx) {
    const calc = getSavingsCalculator();
    const typeLabel = tx.type === 'deposit' ? 'Deposit' : tx.type === 'withdrawal' ? 'Withdrawal' : 'Reallocation';
    const icon = tx.type === 'deposit' ? '⬇️' : tx.type === 'withdrawal' ? '⬆️' : '🔄';
    const isPositive = tx.type === 'deposit' || tx.type === 'reallocate';
    const goal = tx.goalId ? _storageSvc().getGoalById(tx.goalId) : null;
    const balanceAfter = tx.balanceAfter != null
      ? tx.balanceAfter
      : goal ? goal.savedAmount : null;
    const date = new Date(tx.timestamp);

    return `
      <div class="receipt">
        <div class="receipt-head">
          <div class="receipt-brand">
            <div class="receipt-brand-icon">🏦</div>
            <div>
              <div class="receipt-brand-name">Salvis</div>
              <div class="receipt-brand-tag">Official Digital Transaction Receipt</div>
            </div>
          </div>
          <div class="receipt-status">✓ Successful</div>
        </div>

        <div class="receipt-amount-line">
          <span class="receipt-amount">${isPositive ? '+' : '-'}${calc.formatCurrency(tx.amount)}</span>
          <span class="receipt-type-badge">${icon} ${typeLabel}</span>
        </div>

        <div class="receipt-details">
          <div class="receipt-row"><span>Reference ID</span><strong>${esc(this._receiptReference(tx))}</strong></div>
          <div class="receipt-row"><span>Date & Time</span><strong>${date.toLocaleString()}</strong></div>
          <div class="receipt-row"><span>Payment Rail</span><strong>${esc(tx.rail || tx.method || 'Vault Ledger')}</strong></div>
          <div class="receipt-row"><span>Destination Vault</span><strong>${esc(tx.goalName || 'Wallet Transfer')}</strong></div>
          ${balanceAfter != null ? `<div class="receipt-row"><span>Balance After</span><strong>${calc.formatCurrency(balanceAfter)}</strong></div>` : ''}
        </div>

        <div class="receipt-foot">This is a sandbox receipt for demo purposes. Keep this reference for your records.</div>
      </div>
    `;
  }

  static openReceiptModal(txId) {
    const tx = this.getTransactionById(txId) || this.state.lastReceiptTx;
    if (!tx) return;
    const modal = document.getElementById('receiptModal');
    if (!modal) return;
    document.getElementById('receiptBody').innerHTML = this._receiptHTML(tx);
    document.getElementById('receiptRefEcho').textContent = this._receiptReference(tx);
    this.state.lastReceiptTx = tx;
    document.getElementById('btnPrintReceipt')?.addEventListener('click', () => this.printReceipt());
    document.getElementById('btnCloseReceipt')?.addEventListener('click', () => this.closeModal('receiptModal'));
    if (typeof window.ModalManager !== 'undefined') window.ModalManager.open('receiptModal');
    else modal.classList.add('active');
  }

  static printReceipt() {
    const modal = document.getElementById('receiptModal');
    const opener = document.activeElement;
    window.print();
    if (opener && opener.focus) setTimeout(() => opener.focus(), 60);
  }

  // ===================== BACKUP / RESTORE =====================

  static downloadDatabaseBackup() {
    try {
      const storage = _storageSvc();
      if (typeof storage.downloadBackupFile !== 'function') {
        this.showToast('Backup is unavailable in this build.', 'error');
        return;
      }
      const summary = storage.downloadBackupFile();
      this.showToast(`Backup exported — ${summary.keys} records saved 💾`, 'success');
    } catch (e) {
      this.showToast('Backup export failed: ' + e.message, 'error');
    }
  }

  static openBackupImportPicker() {
    const input = document.getElementById('backupRestoreFileInput');
    if (input) input.click();
  }

  static async handleBackupRestoreFile(event) {
    const file = event.target && event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const preview = _storageSvc().previewDatabaseJSON(text);
      if (!preview.valid) {
        this.showToast(preview.error || 'Invalid backup file.', 'error');
        return;
      }
      const summary = preview.summary || {};
      const exportedDate = preview.exportedAt ? new Date(preview.exportedAt).toLocaleString() : 'unknown date';
      let msg = `Restore backup from ${exportedDate}? This will overwrite your current Salvis data with ${summary.keys != null ? summary.keys : 'all'} stored records.`;
      if (preview.existingUserMatches > 0) msg += ` (${preview.existingUserMatches} account(s) already exist and will be updated.)`;
      this.confirmAction(msg, () => this._applyBackupRestore(text));
    } catch (e) {
      this.showToast('Could not read backup file: ' + e.message, 'error');
    } finally {
      if (event.target) event.target.value = '';
    }
  }

  static _applyBackupRestore(text) {
    const res = _storageSvc().importDatabaseJSON(text);
    if (res.success) {
      this.showToast(`Backup restored — ${res.appliedKeys} records rehydrated 💾`, 'success');
      const auth = getAuthService();
      if (!auth.getCurrentUser()) {
        if (typeof window.location !== 'undefined') window.location.reload();
        return;
      }
      this.renderAll();
      if (typeof window.renderProfileView === 'function') window.renderProfileView();
    } else {
      this.showToast(res.error || 'Restore failed.', 'error');
    }
  }

  // ===================== LEDGER + CSV =====================

  static openLedgerModal() {
    const modal = document.getElementById('ledgerModal');
    if (!modal) return;

    const txs = _storageSvc().getTransactions();
    const container = document.getElementById('ledgerTxList');
    const calc = getSavingsCalculator();

    if (txs.length === 0) {
      container.innerHTML = `<div class="empty-state compact"><div class="empty-illustration">🧾</div><h3>No Transactions Yet</h3><p>Deposits, withdrawals and reallocations appear here.</p></div>`;
    } else {
      container.innerHTML = txs.map((tx) => {
        const isPositive = tx.type === 'deposit' || tx.type === 'reallocate';
        const iconClass = tx.type === 'deposit' ? 'deposit' : tx.type === 'withdrawal' ? 'withdrawal' : 'reallocate';
        const icon = tx.type === 'deposit' ? '⬇️' : tx.type === 'withdrawal' ? '⬆️' : '🔄';

        return `
          <div class="tx-item">
            <div class="tx-icon ${iconClass}">${icon}</div>
            <div class="tx-info">
              <div class="tx-title">${esc(tx.goalName)}</div>
              <div class="tx-date">${new Date(tx.timestamp).toLocaleString()} • ${esc(tx.method)}</div>
            </div>
            <div class="tx-amount ${isPositive ? 'positive' : 'negative'}">
              ${isPositive ? '+' : '-'}${calc.formatCurrency(tx.amount)}
            </div>
            <button type="button" class="btn btn-secondary btn-sm tx-receipt-btn" data-tx-id="${esc(tx.id)}" title="View digital receipt" style="margin-left: 0.6rem;">🧾</button>
          </div>
        `;
      }).join('');

      container.querySelectorAll('.tx-receipt-btn').forEach((btn) => {
        btn.addEventListener('click', () => this.openReceiptModal(btn.getAttribute('data-tx-id')));
      });
    }

    modal.classList.add('active');
  }

  static exportTransactionsCSV() {
    const txs = _storageSvc().getTransactions();
    const calc = getSavingsCalculator();

    const escCsv = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const header = ['Date', 'Time', 'Type', 'Method', 'Vault', 'Amount'];
    const rows = txs.map((tx) => [
      new Date(tx.timestamp).toLocaleDateString(),
      new Date(tx.timestamp).toLocaleTimeString(),
      tx.type || 'info',
      tx.method || 'Vault Ledger',
      tx.goalName || 'Wallet Transfer',
      (tx.amount || 0).toFixed(2)
    ]);

    const csv = [header.map(escCsv).join(','), ...rows.map((r) => r.map(escCsv).join(','))].join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `salvis-transactions-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    this.showToast('Transaction ledger exported to CSV 📊');
  }

  // ===================== CONFIRM DIALOG =====================

  static confirmAction(message, onConfirm) {
    const modal = document.getElementById('confirmModal');
    if (!modal) return;
    document.getElementById('confirmBody').innerHTML = `<p>${esc(message)}</p>`;
    this.state.pendingConfirm = onConfirm;
    modal.classList.add('active');
  }

  static _resolveConfirm(proceed) {
    const cb = this.state.pendingConfirm;
    this.state.pendingConfirm = null;
    this.closeModal('confirmModal');
    if (proceed && typeof cb === 'function') cb();
  }

  // ===================== PIN AUTHORIZATION =====================

  static requestPinAuthorization(actionCallback) {
    this.state.pendingActionWithPin = actionCallback;
    this.state.pinValue = '';
    this.updatePinDisplay();
    this.openModal('pinModal');
  }

  static updatePinDisplay() {
    const dots = document.querySelectorAll('#pinDisplay .pin-dot');
    dots.forEach((dot, idx) => {
      if (idx < this.state.pinValue.length) dot.classList.add('filled');
      else dot.classList.remove('filled');
    });
  }

  static async submitPinVerification() {
    const auth = getAuthService();
    const res = await auth.verifyPin(this.state.pinValue);
    if (res && res.success) {
      this.closeModal('pinModal');
      const cb = this.state.pendingActionWithPin;
      this.state.pendingActionWithPin = null;
      this.showToast('🔒 Security PIN Verified');
      if (cb) cb();
    } else {
      if (res && res.locked) {
        this.showToast(`Too many attempts. Try again in ${auth.formatLockout(res.remainingMs)}s 🔒`, 'error');
        this.closeModal('pinModal');
        this.state.pendingActionWithPin = null;
      } else {
        this.showToast((res && res.error) || 'Invalid Security PIN', 'error');
        this.state.pinValue = '';
        this.updatePinDisplay();
      }
    }
  }

  // ===================== CELEBRATION =====================

  static celebrateCompletion(goalName = '') {
    if (document.getElementById('confettiLayer')) document.getElementById('confettiLayer').remove();
    const layer = document.createElement('div');
    layer.id = 'confettiLayer';
    document.body.appendChild(layer);

    const colors = ['#10b981', '#38bdf8', '#818cf8', '#f59e0b', '#f43f5e', '#34d399'];
    for (let i = 0; i < 70; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      const size = 6 + Math.random() * 8;
      piece.style.width = size + 'px';
      piece.style.height = size * (0.5 + Math.random() * 0.8) + 'px';
      piece.style.left = Math.random() * 100 + '%';
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDuration = 1.6 + Math.random() * 1.6 + 's';
      piece.style.animationDelay = Math.random() * 0.7 + 's';
      piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
      layer.appendChild(piece);
    }

    this.showToast(`🎉 Goal Reached: ${goalName || 'Achievement Unlocked'}!`, 'success');
    setTimeout(() => {
      if (layer && layer.parentNode) layer.remove();
    }, 4200);
  }

  // ===================== EVENTS =====================

  static bindEvents() {
    document.getElementById('loginForm')?.addEventListener('submit', (e) => {
      if (typeof window.loginWithPassword === 'function') window.loginWithPassword(e);
    });

    document.getElementById('signupForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('signupName').value.trim();
      const email = document.getElementById('signupEmail').value.trim();
      const pass = document.getElementById('signupPassword').value;
      const pin = document.getElementById('signupPin').value;

      if (!name || !email || !pass || !pin) {
        this.showToast('Please fill in all signup fields 📝', 'warning');
        return;
      }
      if (pass.length < 6) {
        this.showToast('Password must be at least 6 characters long 🔐', 'warning');
        return;
      }
      const res = await getAuthService().signup(name, email, pass, pin);
      if (res.success) {
        this.showToast(`Account registered successfully! Welcome, ${esc(res.user.name)} 🚀`);
        this.checkAuthState();
      } else {
        this.showToast(res.error, 'error');
      }
    });

    document.getElementById('btnToggleAuthMode')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.toggleAuthMode();
    });

    document.getElementById('btnLogout')?.addEventListener('click', (e) => {
      if (e) e.preventDefault();
      if (typeof window.logoutUser === 'function') window.logoutUser();
    });

    document.getElementById('btnOpenChangePinModal')?.addEventListener('click', (e) => {
      if (e) e.preventDefault();
      if (typeof window.openChangePinModal === 'function') window.openChangePinModal();
    });

    document.querySelectorAll('.tab-btn').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        this.state.activeFilter = tab.getAttribute('data-filter');
        this.renderGoals();
      });
    });

    document.getElementById('btnCreateGoal')?.addEventListener('click', () => this.openWizardModal());
    document.getElementById('btnViewLedger')?.addEventListener('click', () => this.openLedgerModal());

    const searchInput = document.getElementById('vaultSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', this._debouncedSearch());
    }
    const sortSelect = document.getElementById('vaultSortSelect');
    if (sortSelect) {
      sortSelect.addEventListener('change', () => {
        this.state.sortMode = sortSelect.value;
        this.renderGoals();
      });
    }

    document.getElementById('btnNotifications')?.addEventListener('click', () => {
      const notif = getNotifications();
      if (notif && notif.togglePanel) notif.togglePanel();
    });

    document.getElementById('btnExportLedger')?.addEventListener('click', () => this.exportTransactionsCSV());

    document.getElementById('confirmCancelBtn')?.addEventListener('click', () => this._resolveConfirm(false));
    document.getElementById('confirmProceedBtn')?.addEventListener('click', () => this._resolveConfirm(true));

    const navToggle = document.getElementById('navMenuToggle');
    if (navToggle) {
      navToggle.addEventListener('click', () => {
        const actions = document.getElementById('navActions');
        if (actions) actions.classList.toggle('open');
      });
    }

    const fab = document.getElementById('scrollTopFab');
    if (fab) {
      window.addEventListener('scroll', () => {
        fab.classList.toggle('show', (window.scrollY || window.pageYOffset) > 400);
      }, { passive: true });
      fab.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    }

    document.querySelectorAll('.modal-overlay').forEach((overlay) => {
      overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay && typeof window.ModalManager === 'undefined') {
          overlay.classList.remove('active');
        }
      });
    });

    document.querySelectorAll('.keypad-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = btn.getAttribute('data-key');
        if (val === 'clear') this.state.pinValue = '';
        else if (val === 'back') this.state.pinValue = this.state.pinValue.slice(0, -1);
        else if (this.state.pinValue.length < 4) this.state.pinValue += val;
        this.updatePinDisplay();
        if (this.state.pinValue.length === 4) {
          setTimeout(() => this.submitPinVerification(), 150);
        }
      });
    });

    this._bindRipple();
  }

  static _debouncedSearch() {
    let timer = null;
    return (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        this.state.searchQuery = e.target.value;
        this.renderGoals();
      }, 220);
    };
  }

  static toggleAuthMode() {
    const loginBox = document.getElementById('loginBox');
    const signupBox = document.getElementById('signupBox');
    const toggleBtn = document.getElementById('btnToggleAuthMode');
    if (loginBox && signupBox && toggleBtn) {
      if (loginBox.style.display === 'none') {
        loginBox.style.display = 'block';
        signupBox.style.display = 'none';
        toggleBtn.textContent = "Don't have an account? Sign Up";
      } else {
        loginBox.style.display = 'none';
        signupBox.style.display = 'block';
        toggleBtn.textContent = 'Already have an account? Log In';
      }
    }
  }

  static _bindRipple() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('.btn');
      if (!btn || btn.closest('.theme-toggle-btn')) return;
      const rect = btn.getBoundingClientRect();
      const ripple = document.createElement('span');
      ripple.className = 'ripple';
      const size = Math.max(rect.width, rect.height);
      ripple.style.width = ripple.style.height = size + 'px';
      ripple.style.left = e.clientX - rect.left - size / 2 + 'px';
      ripple.style.top = e.clientY - rect.top - size / 2 + 'px';
      btn.appendChild(ripple);
      setTimeout(() => ripple.remove(), 700);
    });
  }

  static bindKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const notif = getNotifications();
        if (notif && notif.togglePanel) {
          const panel = document.getElementById('notificationPanel');
          if (panel && panel.style.display === 'flex') {
            panel.style.display = 'none';
            return;
          }
        }
        if (typeof window.ModalManager !== 'undefined') {
          window.ModalManager.closeTop();
        } else {
          const openModals = Array.prototype.slice.call(document.querySelectorAll('.modal-overlay.active'));
          if (openModals.length) {
            const top = openModals.pop();
            top.classList.remove('active');
            if (top.id === 'pinModal') this.state.pinValue = '';
          }
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const search = document.getElementById('vaultSearchInput');
        if (search) search.focus();
      }
    });
  }
}

if (typeof window !== 'undefined') {
  window.UIRenderer = UIRenderer;
  window.toggleAuthMode = UIRenderer.toggleAuthMode;
  window.setVaultType = UIRenderer.setVaultType.bind(UIRenderer);
  window.fetchProductMetadata = UIRenderer.fetchProductMetadata.bind(UIRenderer);
}