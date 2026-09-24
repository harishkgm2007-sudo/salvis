/**
 * Storage Service — versioned, quota-aware, per-user isolated persistence
 */

const STORAGE_VERSION = '2.0';

const STORAGE_KEYS = {
  VERSION: 'salvis_storage_version',
  USERS: 'salvis_users',
  GOALS: 'salvis_goals',
  TRANSACTIONS: 'salvis_transactions',
  WALLET_BALANCE: 'salvis_wallet',
  BANK_ACCOUNTS: 'salvis_bank_accounts',
  PROFILES: 'salvis_profiles'
};

const SESSION_KEYS = {
  CURRENT_USER: 'salvis_session_user',
  LEGACY_USER: 'salvis_current_user',
  PENDING_USER: 'salvis_pending_user'
};

function getScopeKey(baseKey) {
  let userId = null;
  try {
    const raw =
      localStorage.getItem(SESSION_KEYS.CURRENT_USER) ||
      localStorage.getItem(SESSION_KEYS.LEGACY_USER);
    if (raw) {
      const u = JSON.parse(raw);
      userId = u && u.id ? u.id : null;
    }
  } catch (e) {}
  return userId ? `${baseKey}_${userId}` : baseKey;
}

const DEFAULT_PROFILE = { id: 'prof-' + Date.now(), profileName: 'Personal Savings Vault', type: 'personal', isActive: true };

class StorageService {
  static init() {
    try {
      const prevVersion = localStorage.getItem(STORAGE_KEYS.VERSION);
      localStorage.setItem(STORAGE_KEYS.VERSION, STORAGE_VERSION);
      if (prevVersion && prevVersion !== STORAGE_VERSION) {
        // Future migration hooks live here.
        if (typeof console !== 'undefined') {
          console.info(`[Salvis] Storage migrated ${prevVersion} -> ${STORAGE_VERSION}`);
        }
      }
    } catch (e) {}
  }

  static getStorageVersion() {
    return localStorage.getItem(STORAGE_KEYS.VERSION) || STORAGE_VERSION;
  }

  static setItemSafe(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      return false;
    }
  }

  static lastStorageError() {
    try {
      const probe = new Array(256 * 1024).join('x');
      localStorage.setItem('salvis_quota_probe', probe);
      localStorage.removeItem('salvis_quota_probe');
      return null;
    } catch (e) {
      return e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014)
        ? 'Storage quota exceeded. Please export your records and clear local data to free space.'
        : 'Local storage is unavailable in this browser context.';
    }
  }

  // Users (global registry — no secrets between accounts is shared here)
  static getUsers() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.USERS);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  static saveUsers(users) {
    this.setItemSafe(STORAGE_KEYS.USERS, JSON.stringify(users));
  }

  static clearAllDatabase() {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf('salvis_') === 0) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
      this.init();
    } catch (e) {}
  }

  // Wallet (per user)
  static getWalletBalance() {
    try {
      return parseFloat(localStorage.getItem(getScopeKey(STORAGE_KEYS.WALLET_BALANCE)) || '0') || 0;
    } catch (e) {
      return 0;
    }
  }

  static updateWalletBalance(deltaAmount) {
    const current = this.getWalletBalance();
    const updated = Math.max(0, current + deltaAmount);
    this.setItemSafe(getScopeKey(STORAGE_KEYS.WALLET_BALANCE), JSON.stringify(updated));
    return updated;
  }

  // Goals (per user)
  static getGoals() {
    try {
      return JSON.parse(localStorage.getItem(getScopeKey(STORAGE_KEYS.GOALS)) || '[]');
    } catch (e) {
      return [];
    }
  }

  static getGoalById(id) {
    return this.getGoals().find((g) => g.id === id);
  }

  static saveGoal(goal) {
    const goals = this.getGoals();
    const idx = goals.findIndex((g) => g.id === goal.id);
    if (idx >= 0) goals[idx] = goal;
    else goals.unshift(goal);
    this.setItemSafe(getScopeKey(STORAGE_KEYS.GOALS), JSON.stringify(goals));
    return goal;
  }

  static updateGoalStatus(id, newStatus) {
    const goal = this.getGoalById(id);
    if (goal) {
      goal.status = newStatus;
      this.saveGoal(goal);
    }
    return goal;
  }

  static deleteOrCancelGoal(id) {
    const goals = this.getGoals().filter((g) => g.id !== id);
    this.setItemSafe(getScopeKey(STORAGE_KEYS.GOALS), JSON.stringify(goals));
  }

  // Transactions (per user)
  static getTransactions() {
    try {
      return JSON.parse(localStorage.getItem(getScopeKey(STORAGE_KEYS.TRANSACTIONS)) || '[]');
    } catch (e) {
      return [];
    }
  }

  static _txReference(id) {
    const seed = String(id || '');
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
    return 'SAL' + String(Math.abs(h) % 100000).padStart(5, '0');
  }

  static recordTransaction({ goalId, goalName, amount, type, method, rail, reference, balanceAfter }) {
    const txs = this.getTransactions();
    const newTx = {
      id: 'tx-' + Date.now(),
      reference: reference || this._txReference('tx-' + Date.now()),
      goalId: goalId || null,
      goalName: goalName || 'Wallet Transfer',
      amount: parseFloat(amount) || 0,
      type,
      method: method || 'Vault Ledger',
      rail: rail || null,
      balanceAfter: parseFloat(balanceAfter) || null,
      timestamp: new Date().toISOString()
    };
    txs.unshift(newTx);
    this.setItemSafe(getScopeKey(STORAGE_KEYS.TRANSACTIONS), JSON.stringify(txs));
    return newTx;
  }

  // Bank Accounts (per user)
  static getBankAccounts() {
    try {
      const stored = JSON.parse(localStorage.getItem(getScopeKey(STORAGE_KEYS.BANK_ACCOUNTS)) || '[]');
      return Array.isArray(stored) ? stored : [];
    } catch (e) {
      return [];
    }
  }

  static addBankAccount(bankData) {
    const banks = this.getBankAccounts();
    const newBank = {
      id: 'bank-' + Date.now(),
      bankName: bankData.bankName || 'Partner Bank',
      accountNumber:
        '•••• ' +
        (bankData.accountNumber && bankData.accountNumber.length >= 4
          ? bankData.accountNumber.slice(-4)
          : '1234'),
      routingNumber: bankData.routingNumber || '000000000',
      accountType: bankData.accountType || 'Savings Account',
      isPrimary: banks.length === 0
    };
    banks.push(newBank);
    this.setItemSafe(getScopeKey(STORAGE_KEYS.BANK_ACCOUNTS), JSON.stringify(banks));
    return newBank;
  }

  // Profiles (per user)
  static getProfiles() {
    try {
      const stored = JSON.parse(localStorage.getItem(getScopeKey(STORAGE_KEYS.PROFILES)) || '[]');
      return Array.isArray(stored) && stored.length > 0 ? stored : [DEFAULT_PROFILE];
    } catch (e) {
      return [DEFAULT_PROFILE];
    }
  }

  static addProfile(name, type = 'personal') {
    const profiles = this.getProfiles();
    const newProf = {
      id: 'prof-' + Date.now(),
      profileName: name || 'Custom Vault Profile',
      type,
      isActive: profiles.length === 0
    };
    profiles.push(newProf);
    this.setItemSafe(getScopeKey(STORAGE_KEYS.PROFILES), JSON.stringify(profiles));
    return newProf;
  }

  static setActiveProfile(profileId) {
    const profiles = this.getProfiles();
    profiles.forEach((p) => (p.isActive = p.id === profileId));
    this.setItemSafe(getScopeKey(STORAGE_KEYS.PROFILES), JSON.stringify(profiles));
  }

  // ===================== FULL DATABASE BACKUP / RESTORE =====================

  static _collectStoragePayload() {
    const payload = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf('salvis_') === 0 && k.indexOf('salvis_quota_probe') !== 0) {
          payload[k] = localStorage.getItem(k);
        }
      }
    } catch (e) {}
    return payload;
  }

  static _backupSummary() {
    const keys = Object.keys(this._collectStoragePayload());
    return {
      keys: keys.length,
      users: this.getUsers().length,
      goals: this.getGoals().length,
      transactions: this.getTransactions().length,
      bankAccounts: this.getBankAccounts().length,
      profiles: this.getProfiles().length,
      wallet: this.getWalletBalance()
    };
  }

  /**
   * Build a complete JSON backup of every Salvis local-storage record.
   */
  static exportDatabaseJSON() {
    const data = {
      app: 'Salvis',
      format: 'salvis-backup',
      version: STORAGE_VERSION,
      exportedAt: new Date().toISOString(),
      summary: this._backupSummary(),
      payload: this._collectStoragePayload()
    };
    return JSON.stringify(data, null, 2);
  }

  static downloadBackupFile(filename) {
    const json = this.exportDatabaseJSON();
    const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `salvis-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return JSON.parse(json).summary;
  }

  /**
   * Validate & inspect a backup file before applying (duplicate detection).
   */
  static previewDatabaseJSON(jsonData) {
    let data = null;
    try {
      data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
    } catch (e) {
      return { valid: false, error: 'File is not valid JSON.' };
    }
    if (!data || data.format !== 'salvis-backup' || !data.payload || typeof data.payload !== 'object') {
      return { valid: false, error: 'Not a valid Salvis backup file (missing salvis-backup format header).' };
    }
    if (data.app && data.app !== 'Salvis') {
      return { valid: false, error: 'This backup was not created by Salvis.' };
    }
    const currentUsers = this.getUsers().map((u) => (u.email || '').toLowerCase()).filter(Boolean);
    let existingMatches = 0;
    const incoming = [];
    Object.keys(data.payload).forEach((k) => {
      if (k === STORAGE_KEYS.USERS) {
        try {
          const list = JSON.parse(data.payload[k]);
          if (Array.isArray(list)) {
            list.forEach((u) => {
              if (u && u.email) {
                incoming.push(u.email.toLowerCase());
                if (currentUsers.indexOf(u.email.toLowerCase()) !== -1) existingMatches++;
              }
            });
          }
        } catch (e) {}
      }
    });
    return {
      valid: true,
      app: data.app,
      version: data.version,
      exportedAt: data.exportedAt,
      summary: data.summary || { keys: Object.keys(data.payload).length },
      incomingUsers: incoming.length,
      existingUserMatches: existingMatches
    };
  }

  /**
   * Restore a full backup with instant state rehydration.
   */
  static importDatabaseJSON(jsonData) {
    const preview = this.previewDatabaseJSON(jsonData);
    if (!preview.valid) return { success: false, error: preview.error };

    let data = null;
    try {
      data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
    } catch (e) {
      return { success: false, error: 'File is not valid JSON.' };
    }

    const before = this.getUsers().length;
    let applied = 0;
    Object.keys(data.payload).forEach((k) => {
      if (this.setItemSafe(k, data.payload[k])) applied++;
    });
    this.init();

    return {
      success: true,
      appliedKeys: applied,
      usersBefore: before,
      usersAfter: this.getUsers().length,
      summary: data.summary || null
    };
  }
}

if (typeof window !== 'undefined') {
  window.StorageService = StorageService;
  try {
    StorageService.init();
  } catch (e) {}
}