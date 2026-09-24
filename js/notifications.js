/**
 * In-App Notification Center
 * Milestone alerts, overdue warnings, deposit reminders
 */

const NOTIFICATION_THRESHOLDS = [25, 50, 75, 100];

const getStorage = () => {
  if (typeof StorageService !== 'undefined') return StorageService;
  return window.StorageService || null;
};

const getAuth = () => {
  if (typeof AuthService !== 'undefined') return AuthService;
  return window.AuthService || null;
};

function scopeKey(base) {
  try {
    const auth = getAuth();
    const user = auth ? auth.getCurrentUser() : null;
    return user && user.id ? `${base}_${user.id}` : base;
  } catch (e) {
    return base;
  }
}

class NotificationService {
  static getNotifications() {
    try {
      const raw = localStorage.getItem(scopeKey('salvis_notifications'));
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  static saveNotifications(list) {
    try {
      localStorage.setItem(scopeKey('salvis_notifications'), JSON.stringify(list.slice(0, 50)));
    } catch (e) {}
  }

  static addNotification({ type = 'info', title, message, goalId = null, key = null }) {
    const list = this.getNotifications();
    if (key) {
      const exists = list.some((n) => n.key === key);
      if (exists) return list;
      list.unshift({
        id: 'ntf-' + Date.now() + '-' + Math.floor(Math.random() * 999),
        key,
        type,
        title,
        message,
        goalId,
        date: new Date().toISOString(),
        read: false
      });
    } else {
      list.unshift({
        id: 'ntf-' + Date.now() + '-' + Math.floor(Math.random() * 999),
        type,
        title,
        message,
        goalId,
        date: new Date().toISOString(),
        read: false
      });
    }
    this.saveNotifications(list);
    this.updateBell();
    return list;
  }

  static markAllRead() {
    const list = this.getNotifications();
    list.forEach((n) => (n.read = true));
    this.saveNotifications(list);
    this.updateBell();
  }

  static unreadCount() {
    return this.getNotifications().filter((n) => !n.read).length;
  }

  static _milestoneMap() {
    try {
      const raw = localStorage.getItem(scopeKey('salvis_milestones'));
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  static _saveMilestoneMap(map) {
    try {
      localStorage.setItem(scopeKey('salvis_milestones'), JSON.stringify(map));
    } catch (e) {}
  }

  /**
   * Emit milestone notifications as a goal crosses 25/50/75/100%.
   */
  static checkMilestones(goal) {
    if (!goal || goal.status !== 'active') return;
    const target = parseFloat(goal.targetAmount) || 0;
    if (target <= 0) return;
    const pct = Math.min(100, (parseFloat(goal.savedAmount) || 0) / target * 100);

    const map = this._milestoneMap();
    const prev = map[goal.id] || 0;
    let best = prev;
    let hit100 = false;

    NOTIFICATION_THRESHOLDS.forEach((t) => {
      if (pct >= t && prev < t) {
        best = t;
        const pctLabel = t === 100 ? 'Goal reached' : `${t}% of target`;
        this.addNotification({
          type: t === 100 ? 'success' : 'milestone',
          title: t === 100 ? '🎉 Vault Completed!' : '🎯 Milestone Reached',
          message: `You've hit ${pctLabel} on "${goal.itemName}" — ${pct.toFixed(1)}% saved!`,
          goalId: goal.id,
          key: `m-${goal.id}-${t}`
        });
        if (t === 100) hit100 = true;
      }
    });

    map[goal.id] = Math.max(prev, best);

    // Roll back ceiling if funds were withdrawn below a threshold.
    const ceiling = NOTIFICATION_THRESHOLDS.filter((t) => pct >= t).pop() || 0;
    if (map[goal.id] > ceiling) map[goal.id] = ceiling;
    this._saveMilestoneMap(map);
    return hit100;
  }

  /**
   * Warn about goals whose target date has passed.
   */
  static checkOverdue(goals) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    (goals || []).forEach((g) => {
      if (g.status === 'completed' || g.status === 'cancelled') return;
      const targetDate = new Date(g.targetDate);
      if (isNaN(targetDate.getTime())) return;
      targetDate.setHours(0, 0, 0, 0);
      if (targetDate.getTime() < today.getTime()) {
        this.addNotification({
          type: 'overdue',
          title: '⏰ Vault Overdue',
          message: `"${g.itemName}" passed its target date (${g.targetDate}). Review or extend your target.`,
          goalId: g.id,
          key: `overdue-${g.id}-${g.targetDate}`
        });
      }
    });
  }

  /**
   * Reminder if the deposit cadence has been missed.
   */
  static checkReminders(goals) {
    const today = new Date();
    (goals || []).forEach((g) => {
      if (g.status !== 'active') return;
      const intervalDays = { daily: 1, weekly: 7, biweekly: 14, monthly: 30 }[g.frequency] || 7;
      let last = null;
      try {
        const storage = getStorage();
        if (storage && storage.getTransactions) {
          const txs = storage.getTransactions().filter((tx) => tx.goalId === g.id && tx.type === 'deposit');
          if (txs.length) last = new Date(txs[0].timestamp);
        }
      } catch (e) {}
      const anchor = last || (g.startDate ? new Date(g.startDate) : today);
      const elapsed = Math.floor((today.getTime() - anchor.getTime()) / (1000 * 60 * 60 * 24));
      if (elapsed > intervalDays) {
        this.addNotification({
          type: 'reminder',
          title: '💸 Deposit Reminder',
          message: `Time to top up "${g.itemName}" — no deposit in ${Math.floor(elapsed)} days.`,
          goalId: g.id,
          key: `rem-${g.id}-${Math.floor(today.getTime() / 86400000)}`
        });
      }
    });
  }

  /**
   * Full refresh used after app render or data mutation.
   */
  static refresh(goals) {
    this.checkOverdue(goals);
    this.checkReminders(goals);
    this.updateBell();
  }

  static startAutoRefresh() {
    if (this._timer) clearInterval(this._timer);
    this._timer = setInterval(() => this.updateBell(), 60000);
  }

  // ----- Bell UI -----

  static updateBell() {
    const badge = document.getElementById('notificationBadge');
    if (!badge) return;
    const count = this.unreadCount();
    if (count > 0) {
      badge.textContent = count > 9 ? '9+' : String(count);
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  static togglePanel() {
    const panel = document.getElementById('notificationPanel');
    if (!panel) return;
    const shown = panel.style.display === 'flex';
    if (shown) {
      panel.style.display = 'none';
      return;
    }
    this.renderPanel();
    panel.style.display = 'flex';
  }

  static renderPanel() {
    const panel = document.getElementById('notificationPanel');
    if (!panel) return;
    const list = this.getNotifications();

    if (list.length === 0) {
      panel.innerHTML = `
        <div style="padding: 1.5rem; text-align: center;">
          <div style="font-size: 1.8rem; margin-bottom: 0.4rem;">🔔</div>
          <div style="font-size: 0.9rem; font-weight: 700; color: var(--text-primary);">All caught up!</div>
          <div style="font-size: 0.78rem; color: var(--text-muted);">Milestone alerts and reminders appear here.</div>
        </div>
      `;
      return;
    }

    const esc = window.SalvisUtils ? SalvisUtils.escapeHtml : (window.escapeHtml || ((v) => v));
    panel.innerHTML = `
      <div class="ntf-header">
        <span>Notifications</span>
        <button class="ntf-mark-read" onclick="window.NotificationService.markAllRead(); window.NotificationService.renderPanel();">
          Mark all read
        </button>
      </div>
      <div class="ntf-list">
        ${list.map((n) => `
          <div class="ntf-item ${n.read ? 'read' : ''}" data-type="${n.type}">
            <div class="ntf-item-title">${esc(n.title)}</div>
            <div class="ntf-item-msg">${esc(n.message)}</div>
            <div class="ntf-item-date">${new Date(n.date).toLocaleString()}</div>
          </div>
        `).join('')}
      </div>
    `;
  }
}

if (typeof window !== 'undefined') {
  window.NotificationService = NotificationService;
}