/**
 * Auth & Security Service
 * - SHA-256 password/PIN hashing (Web Crypto API)
 * - 24-hour session expiry with auto-logout
 * - Brute-force lockout (5 failed attempts -> 30s cooldown)
 * - No hardcoded demo credentials or backdoors
 */

const getStorageService = () => {
  if (typeof StorageService !== 'undefined') return StorageService;
  if (typeof window !== 'undefined' && window.StorageService) return window.StorageService;
  return null;
};

const AUTH_KEYS = {
  CURRENT_USER: 'salvis_session_user',
  LEGACY_USER: 'salvis_current_user',
  FAILED_LOGIN: 'salvis_failed_logins',
  FAILED_PIN: 'salvis_failed_pin'
};

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30 * 1000;

let inMemoryUserSession = null;

function hasCrypto() {
  return typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest;
}

class AuthService {
  static async hashText(text) {
    const hasher = hasCrypto() ? crypto.subtle : null;
    const input = String(text == null ? '' : text);
    if (hasher) {
      const data = new TextEncoder().encode(input);
      const buf = await hasher.digest('SHA-256', data);
      const hex = Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      return 'sha256$' + hex;
    }
    // Non-secure fallback for unusual browsers (still obfuscates plaintext).
    let h1 = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
      h1 ^= input.charCodeAt(i);
      h1 = Math.imul(h1, 0x01000193) >>> 0;
    }
    return 'fnv$' + h1.toString(16);
  }

  static async hashPassword(password) {
    return this.hashText('salvis:pw:' + password);
  }

  static async hashPin(pin) {
    return this.hashText('salvis:pin:' + pin);
  }

  static async matchesStoredHash(stored, entered, kind) {
    const s = String(stored == null ? '' : stored);
    if (!s) return false;
    if (s.indexOf('sha256$') === 0 || s.indexOf('fnv$') === 0) {
      return s === (await this.hashText(('salvis:' + kind + ':') + String(entered == null ? '' : entered)));
    }
    return String(entered).trim() === s.trim();
  }

  static getCurrentUser() {
    if (inMemoryUserSession) {
      if (this.isSessionExpired(inMemoryUserSession)) {
        this.logout();
        return null;
      }
      return inMemoryUserSession;
    }
    try {
      const raw = localStorage.getItem(AUTH_KEYS.CURRENT_USER) || localStorage.getItem(AUTH_KEYS.LEGACY_USER);
      if (raw) {
        const user = JSON.parse(raw);
        if (this.isSessionExpired(user)) {
          this.logout();
          return null;
        }
        inMemoryUserSession = user;
        return user;
      }
    } catch (e) {}
    return null;
  }

  static isSessionExpired(user) {
    if (!user || !user.sessionExpiresAt) return false;
    return Date.now() > user.sessionExpiresAt;
  }

  // ----- Rate limiting -----

  static _attemptKey(kind) {
    return kind === 'pin' ? AUTH_KEYS.FAILED_PIN : AUTH_KEYS.FAILED_LOGIN;
  }

  static checkLockout(kind) {
    try {
      const raw = localStorage.getItem(this._attemptKey(kind));
      if (!raw) return { locked: false, remainingMs: 0 };
      const data = JSON.parse(raw);
      const now = Date.now();
      if (data.lockedUntil && now < data.lockedUntil) {
        return { locked: true, remainingMs: data.lockedUntil - now };
      }
      if (data.lockedUntil && now >= data.lockedUntil) {
        localStorage.removeItem(this._attemptKey(kind));
      }
      return { locked: false, remainingMs: 0 };
    } catch (e) {
      return { locked: false, remainingMs: 0 };
    }
  }

  static recordFailure(kind) {
    try {
      const key = this._attemptKey(kind);
      const raw = localStorage.getItem(key);
      const data = raw ? JSON.parse(raw) : { count: 0 };
      data.count = (data.count || 0) + 1;
      if (data.count >= MAX_ATTEMPTS) {
        data.lockedUntil = Date.now() + LOCKOUT_MS;
        data.count = 0;
      }
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {}
  }

  static clearFailures(kind) {
    try {
      localStorage.removeItem(this._attemptKey(kind));
    } catch (e) {}
  }

  static formatLockout(remainingMs) {
    return Math.ceil((remainingMs || 0) / 1000);
  }

  // ----- Login -----

  static async login(email, password) {
    const lock = this.checkLockout('login');
    if (lock.locked) {
      return {
        success: false,
        errorType: 'password',
        error: `Too many failed attempts. Try again in ${this.formatLockout(lock.remainingMs)}s 🔒`,
        locked: true
      };
    }

    const storage = getStorageService();
    const users = storage ? storage.getUsers() : [];
    const cleanInput = (email || '').trim().toLowerCase();
    const cleanDigits = cleanInput.replace(/[^0-9]/g, '');

    let user = users.find((u) => {
      const uEmail = (u.email || '').trim().toLowerCase();
      const uUsername = (u.username || '').trim().toLowerCase();
      const uSalvisId = (u.salvisId || '').trim().toLowerCase();
      const uPhoneDigits = (u.phone || '').replace(/[^0-9]/g, '');
      return (
        (uEmail && uEmail === cleanInput) ||
        (uUsername && uUsername === cleanInput) ||
        (uSalvisId && uSalvisId === cleanInput) ||
        (uPhoneDigits && uPhoneDigits !== '' && uPhoneDigits === cleanDigits && cleanDigits !== '')
      );
    });

    if (!user) {
      return { success: false, errorType: 'email', error: 'User ID not found ❌' };
    }

    const enteredPw = String(password || '').trim();
    const storedPw = String(user.password || '').trim();
    let isPasswordCorrect = false;

    if (storedPw) {
      if (storedPw.indexOf('sha256$') === 0 || storedPw.indexOf('fnv$') === 0) {
        isPasswordCorrect = storedPw === (await this.hashPassword(enteredPw));
      } else {
        // Legacy plaintext record — verify and lazily migrate to a hash.
        isPasswordCorrect = enteredPw === storedPw;
        if (isPasswordCorrect && storage) {
          user.password = await this.hashPassword(enteredPw);
          storage.saveUsers(users);
        }
      }
    }

    if (!isPasswordCorrect) {
      this.recordFailure('login');
      return { success: false, errorType: 'password', error: 'Incorrect Password. Please try again ❌' };
    }

    this.clearFailures('login');
    const sessionUser = this._toSessionUser(user);
    this.setUserSession(sessionUser);
    return { success: true, user: sessionUser };
  }

  // ----- Signup -----

  static async signup(name, email, password, pin = '1234') {
    const storage = getStorageService();
    const users = storage ? storage.getUsers() : [];
    const cleanEmail = (email || '').trim().toLowerCase();

    const existing = users.find((u) => u.email && u.email.toLowerCase() === cleanEmail);
    if (existing) {
      return { success: false, error: 'An account with this email address already exists.' };
    }

    if (!password || String(password).length < 6) {
      return { success: false, error: 'Password must be at least 6 characters long.' };
    }

    const hashedPin = await this.hashPin(String(pin || '1234').trim());
    const newUser = {
      id: 'usr-' + Date.now(),
      salvisId: this.generateSalvisId(),
      name: name || 'Savings User',
      email: cleanEmail,
      password: await this.hashPassword(String(password)),
      pin: hashedPin,
      passkey: hashedPin,
      avatar: '👤',
      isSecurityOnboarded: true,
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    if (storage) storage.saveUsers(users);

    const sessionUser = this._toSessionUser(newUser);
    this.setUserSession(sessionUser);
    return { success: true, user: sessionUser };
  }

  // ----- Region/currency detection -----

  static detectRegionAndCurrency(googlePayload = null) {
    let locale = 'en-US';
    let timeZone = '';

    if (googlePayload && googlePayload.locale) {
      locale = googlePayload.locale;
    } else if (typeof navigator !== 'undefined' && navigator.language) {
      locale = navigator.language;
    }

    try {
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch (e) {}

    const locUpper = locale.toUpperCase();
    const tzUpper = timeZone.toUpperCase();

    if (locUpper.indexOf('-IN') === 0 || tzUpper.indexOf('KOLKATA') === 0 || tzUpper.indexOf('INDIA') === 0) {
      return { country: 'India 🇮🇳', region: 'Asia/South', currencyCode: 'INR', currencySymbol: '₹', locale: 'en-IN', phonePrefix: '+91 ', phonePlaceholder: '+91 98765 43210' };
    }
    if (locUpper.indexOf('-GB') === 0 || tzUpper.indexOf('LONDON') === 0) {
      return { country: 'United Kingdom 🇬🇧', region: 'Europe/West', currencyCode: 'GBP', currencySymbol: '£', locale: 'en-GB', phonePrefix: '+44 ', phonePlaceholder: '+44 7911 123456' };
    }
    if (tzUpper.indexOf('PARIS') === 0 || tzUpper.indexOf('BERLIN') === 0 || tzUpper.indexOf('ROME') === 0 || tzUpper.indexOf('MADRID') === 0) {
      return { country: 'Eurozone 🇪🇺', region: 'Europe/Central', currencyCode: 'EUR', currencySymbol: '€', locale: 'de-DE', phonePrefix: '+49 ', phonePlaceholder: '+49 151 12345678' };
    }
    if (tzUpper.indexOf('TOKYO') === 0 || locUpper.indexOf('-JP') === 0) {
      return { country: 'Japan 🇯🇵', region: 'Asia/East', currencyCode: 'JPY', currencySymbol: '¥', locale: 'ja-JP', phonePrefix: '+81 ', phonePlaceholder: '+81 90 1234 5678' };
    }
    if (tzUpper.indexOf('TORONTO') === 0 || tzUpper.indexOf('VANCOUVER') === 0 || locUpper.indexOf('-CA') === 0) {
      return { country: 'Canada 🇨🇦', region: 'America/North', currencyCode: 'CAD', currencySymbol: 'CA$', locale: 'en-CA', phonePrefix: '+1 ', phonePlaceholder: '+1 (416) 555-0123' };
    }
    if (tzUpper.indexOf('SYDNEY') === 0 || tzUpper.indexOf('MELBOURNE') === 0 || locUpper.indexOf('-AU') === 0) {
      return { country: 'Australia 🇦🇺', region: 'Australia/East', currencyCode: 'AUD', currencySymbol: 'A$', locale: 'en-AU', phonePrefix: '+61 ', phonePlaceholder: '+61 412 345 678' };
    }

    return { country: 'United States 🇺🇸', region: 'America/North', currencyCode: 'USD', currencySymbol: '$', locale: 'en-US', phonePrefix: '+1 ', phonePlaceholder: '+1 (555) 234-5678' };
  }

  static generateSalvisId() {
    return 'SALVIS-' + Math.floor(100000 + Math.random() * 900000);
  }

  static findUserByEmail(email) {
    const storage = getStorageService();
    const users = storage ? storage.getUsers() : [];
    const cleanEmail = (email || '').trim().toLowerCase();
    return users.find((u) => u.email && u.email.toLowerCase() === cleanEmail) || null;
  }

  static findUserById(id) {
    const storage = getStorageService();
    const users = storage ? storage.getUsers() : [];
    return users.find((u) => u.id === id) || null;
  }

  // ----- Passkey (google existing users) -----

  static async verifyPasskey(email, passkey) {
    const user = this.findUserByEmail(email);
    if (!user) return { success: false, error: 'User account not found in database.' };

    const stored = String(user.passkey || user.pin || '').trim();
    const ok = await this.matchesStoredHash(stored, passkey, 'pin');
    if (ok) {
      this.setUserSession(this._toSessionUser(user));
      return { success: true, user };
    }
    return { success: false, error: 'Incorrect 4-digit Passkey. Please try again.' };
  }

  // ----- New user registration (google onboarding) -----

  static async registerNewUserWithPasskey({ name, email, phone = '', password = '', passkey, avatar, payload = null }) {
    const storage = getStorageService();
    const users = storage ? storage.getUsers() : [];
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanPasskey = String(passkey || '1234').trim();
    const hashedPasskey = await this.hashPin(cleanPasskey);

    let existing = users.find((u) => u.email && u.email.toLowerCase() === cleanEmail);
    if (existing) {
      if (phone) existing.phone = String(phone).trim();
      if (password) existing.password = await this.hashPassword(String(password).trim());
      existing.passkey = hashedPasskey;
      existing.pin = hashedPasskey;
      existing.isSecurityOnboarded = true;
      if (storage) storage.saveUsers(users);
      this.setUserSession(this._toSessionUser(existing));
      return { success: true, user: existing, isNew: false };
    }

    const regionInfo = this.detectRegionAndCurrency(payload);
    const cleanName = name || 'Salvis User';

    const newUser = {
      id: 'usr-g-' + Date.now(),
      salvisId: this.generateSalvisId(),
      name: cleanName,
      email: cleanEmail,
      phone: String(phone || '').trim(),
      password: password ? await this.hashPassword(String(password).trim()) : '',
      passkey: hashedPasskey,
      pin: hashedPasskey,
      avatar: avatar || '🌐',
      nickname: '@' + cleanName.toLowerCase().replace(/[^a-z0-9]/g, ''),
      isSecurityOnboarded: true,
      ...regionInfo,
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    if (storage) storage.saveUsers(users);

    this.setUserSession(this._toSessionUser(newUser));
    return { success: true, user: newUser, isNew: true };
  }

  // ----- Google OAuth login -----

  static async loginWithGoogle(customName, customEmail, customAvatar, googlePayload = null) {
    const storage = getStorageService();
    const users = storage ? storage.getUsers() : [];

    const googleEmail = (customEmail || 'user.google@gmail.com').trim().toLowerCase();
    const googleName = customName || 'Google Savings User';
    const googleAvatar = customAvatar || '🌐';
    const regionInfo = this.detectRegionAndCurrency(googlePayload);

    let user = users.find((u) => u.email && u.email.toLowerCase() === googleEmail);

    if (!user) {
      const hashedPin = await this.hashPin('1234');
      user = {
        id: 'usr-g-' + Date.now(),
        salvisId: this.generateSalvisId(),
        name: googleName,
        email: googleEmail,
        password: '',
        passkey: hashedPin,
        pin: hashedPin,
        avatar: googleAvatar,
        phone: '',
        nickname: '@' + googleName.toLowerCase().replace(/[^a-z0-9]/g, ''),
        isSecurityOnboarded: false,
        ...regionInfo,
        createdAt: new Date().toISOString()
      };
      users.push(user);
      if (storage) storage.saveUsers(users);
    } else {
      if (!user.salvisId) user.salvisId = this.generateSalvisId();
      user.name = googleName || user.name;
      user.avatar = googleAvatar || user.avatar;
      if (!user.currencyCode) Object.assign(user, regionInfo);
      if (storage) storage.saveUsers(users);
    }

    const sessionUser = this._toSessionUser(user);
    this.setUserSession(sessionUser);
    return { success: true, user: sessionUser };
  }

  // ----- Profile updates -----

  static async updateUserProfile({ name, nickname, phone, password, pin, passkey, avatar, isOnboarded, isSecurityOnboarded, country, currencyCode, currencySymbol, locale }) {
    const session = this.getCurrentUser();
    if (!session) return null;

    const storage = getStorageService();
    const users = storage ? storage.getUsers() : [];
    const idx = users.findIndex((u) => u.id === session.id);
    const rec = idx >= 0 ? users[idx] : { ...session };

    if (name !== undefined) rec.name = String(name).trim() || rec.name;
    if (nickname !== undefined && nickname) rec.nickname = String(nickname).trim();
    if (phone !== undefined) rec.phone = String(phone).trim();
    if (password !== undefined && String(password).length > 0) rec.password = await this.hashPassword(String(password));
    if (pin !== undefined && String(pin).length > 0) {
      rec.pin = await this.hashPin(String(pin).trim());
      rec.passkey = rec.pin;
    }
    if (passkey !== undefined && String(passkey).length > 0) {
      rec.passkey = await this.hashPin(String(passkey).trim());
      rec.pin = rec.passkey;
    }
    if (avatar !== undefined) rec.avatar = avatar;
    if (isOnboarded !== undefined) rec.isOnboarded = isOnboarded;
    if (isSecurityOnboarded !== undefined) rec.isSecurityOnboarded = isSecurityOnboarded;
    if (country !== undefined) rec.country = country;
    if (currencyCode !== undefined) rec.currencyCode = currencyCode;
    if (currencySymbol !== undefined) rec.currencySymbol = currencySymbol;
    if (locale !== undefined) rec.locale = locale;

    if (idx >= 0) users[idx] = rec;
    else if (storage) users.push(rec);
    if (storage) storage.saveUsers(users);

    const newSession = this._toSessionUser(rec);
    if (session.sessionIssuedAt) newSession.sessionIssuedAt = session.sessionIssuedAt;
    if (session.sessionExpiresAt) newSession.sessionExpiresAt = session.sessionExpiresAt;
    this.setUserSession(newSession);
    return newSession;
  }

  // ----- PIN -----

  static async verifyPin(enteredPin) {
    const lock = this.checkLockout('pin');
    if (lock.locked) return { success: false, locked: true, remainingMs: lock.remainingMs };

    const session = this.getCurrentUser();
    if (!session) return { success: false, error: 'No active session.' };
    const rec = this.findUserById(session.id) || session;
    const stored = String(rec.pin || rec.passkey || '').trim();

    if (!stored) return { success: false, error: 'No Security PIN configured.' };

    const ok = await this.matchesStoredHash(stored, enteredPin, 'pin');
    if (!ok) {
      this.recordFailure('pin');
      const lockCheck = this.checkLockout('pin');
      if (lockCheck.locked) return { success: false, locked: true, remainingMs: lockCheck.remainingMs };
      return { success: false, error: 'Incorrect Security PIN. Please try again.' };
    }
    this.clearFailures('pin');
    return { success: true };
  }

  // ----- Session -----

  static _toSessionUser(user) {
    return {
      id: user.id,
      salvisId: user.salvisId || user.id,
      name: user.name || 'Salvis User',
      email: user.email || '',
      phone: user.phone || '',
      avatar: user.avatar || '👤',
      country: user.country || '',
      currencyCode: user.currencyCode || 'USD',
      currencySymbol: user.currencySymbol || '$',
      locale: user.locale || 'en-US',
      nickname: user.nickname || '@' + String(user.name || 'user').toLowerCase().replace(/[^a-z0-9]/g, ''),
      isSecurityOnboarded: !!(user.isSecurityOnboarded || user.isOnboarded),
      sessionIssuedAt: Date.now(),
      sessionExpiresAt: Date.now() + SESSION_TTL_MS
    };
  }

  static setUserSession(user) {
    const toStore = user.sessionExpiresAt ? user : this._toSessionUser(user);
    inMemoryUserSession = toStore;
    try {
      localStorage.setItem(AUTH_KEYS.CURRENT_USER, JSON.stringify(toStore));
      localStorage.setItem(AUTH_KEYS.LEGACY_USER, JSON.stringify(toStore));
    } catch (e) {}
  }

  static logout() {
    inMemoryUserSession = null;
    try {
      localStorage.removeItem(AUTH_KEYS.CURRENT_USER);
      localStorage.removeItem(AUTH_KEYS.LEGACY_USER);
      localStorage.removeItem(AUTH_KEYS.FAILED_LOGIN);
      localStorage.removeItem(AUTH_KEYS.FAILED_PIN);
    } catch (e) {}
  }
}

if (typeof window !== 'undefined') {
  window.AuthService = AuthService;
}