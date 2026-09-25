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
const REGION_GEOLOCATION_ENDPOINT = 'https://ipapi.co/json/';
const REGION_GEOLOCATION_CACHE_KEY = 'salvis_region_geolocation';
const REGION_GEOLOCATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REGION_GEOLOCATION_TIMEOUT_MS = 6000;

const REGION_PRESETS = Object.freeze({
  IN: { countryCode: 'IN', country: 'India 🇮🇳', region: 'Asia/South', currencyCode: 'INR', currencySymbol: '₹', locale: 'en-IN', phonePrefix: '+91 ', phonePlaceholder: '+91 98765 43210' },
  GB: { countryCode: 'GB', country: 'United Kingdom 🇬🇧', region: 'Europe/West', currencyCode: 'GBP', currencySymbol: '£', locale: 'en-GB', phonePrefix: '+44 ', phonePlaceholder: '+44 7911 123456' },
  IE: { countryCode: 'IE', country: 'Ireland 🇮🇪', region: 'Europe/West', currencyCode: 'EUR', currencySymbol: '€', locale: 'en-IE', phonePrefix: '+353 ', phonePlaceholder: '+353 87 123 4567' },
  DE: { countryCode: 'DE', country: 'Germany 🇩🇪', region: 'Europe/Central', currencyCode: 'EUR', currencySymbol: '€', locale: 'de-DE', phonePrefix: '+49 ', phonePlaceholder: '+49 151 12345678' },
  FR: { countryCode: 'FR', country: 'France 🇫🇷', region: 'Europe/West', currencyCode: 'EUR', currencySymbol: '€', locale: 'fr-FR', phonePrefix: '+33 ', phonePlaceholder: '+33 6 12 34 56 78' },
  ES: { countryCode: 'ES', country: 'Spain 🇪🇸', region: 'Europe/West', currencyCode: 'EUR', currencySymbol: '€', locale: 'es-ES', phonePrefix: '+34 ', phonePlaceholder: '+34 612 345 678' },
  IT: { countryCode: 'IT', country: 'Italy 🇮🇹', region: 'Europe/South', currencyCode: 'EUR', currencySymbol: '€', locale: 'it-IT', phonePrefix: '+39 ', phonePlaceholder: '+39 312 345 6789' },
  NL: { countryCode: 'NL', country: 'Netherlands 🇳🇱', region: 'Europe/West', currencyCode: 'EUR', currencySymbol: '€', locale: 'nl-NL', phonePrefix: '+31 ', phonePlaceholder: '+31 6 12345678' },
  BE: { countryCode: 'BE', country: 'Belgium 🇧🇪', region: 'Europe/West', currencyCode: 'EUR', currencySymbol: '€', locale: 'fr-BE', phonePrefix: '+32 ', phonePlaceholder: '+32 470 12 34 56' },
  AT: { countryCode: 'AT', country: 'Austria 🇦🇹', region: 'Europe/Central', currencyCode: 'EUR', currencySymbol: '€', locale: 'de-AT', phonePrefix: '+43 ', phonePlaceholder: '+43 664 1234567' },
  PT: { countryCode: 'PT', country: 'Portugal 🇵🇹', region: 'Europe/West', currencyCode: 'EUR', currencySymbol: '€', locale: 'pt-PT', phonePrefix: '+351 ', phonePlaceholder: '+351 912 345 678' },
  GR: { countryCode: 'GR', country: 'Greece 🇬🇷', region: 'Europe/South', currencyCode: 'EUR', currencySymbol: '€', locale: 'el-GR', phonePrefix: '+30 ', phonePlaceholder: '+30 691 234 5678' },
  FI: { countryCode: 'FI', country: 'Finland 🇫🇮', region: 'Europe/North', currencyCode: 'EUR', currencySymbol: '€', locale: 'fi-FI', phonePrefix: '+358 ', phonePlaceholder: '+358 40 1234567' },
  CH: { countryCode: 'CH', country: 'Switzerland 🇨🇭', region: 'Europe/Central', currencyCode: 'CHF', currencySymbol: 'CHF', locale: 'de-CH', phonePrefix: '+41 ', phonePlaceholder: '+41 79 123 45 67' },
  PL: { countryCode: 'PL', country: 'Poland 🇵🇱', region: 'Europe/Central', currencyCode: 'PLN', currencySymbol: 'zł', locale: 'pl-PL', phonePrefix: '+48 ', phonePlaceholder: '+48 123 456 789' },
  SE: { countryCode: 'SE', country: 'Sweden 🇸🇪', region: 'Europe/North', currencyCode: 'SEK', currencySymbol: 'kr', locale: 'sv-SE', phonePrefix: '+46 ', phonePlaceholder: '+46 70 123 45 67' },
  NO: { countryCode: 'NO', country: 'Norway 🇳🇴', region: 'Europe/North', currencyCode: 'NOK', currencySymbol: 'kr', locale: 'nb-NO', phonePrefix: '+47 ', phonePlaceholder: '+47 406 12 345' },
  DK: { countryCode: 'DK', country: 'Denmark 🇩🇰', region: 'Europe/North', currencyCode: 'DKK', currencySymbol: 'kr.', locale: 'da-DK', phonePrefix: '+45 ', phonePlaceholder: '+45 12 34 56 78' },
  US: { countryCode: 'US', country: 'United States 🇺🇸', region: 'America/North', currencyCode: 'USD', currencySymbol: '$', locale: 'en-US', phonePrefix: '+1 ', phonePlaceholder: '+1 (555) 234-5678' },
  CA: { countryCode: 'CA', country: 'Canada 🇨🇦', region: 'America/North', currencyCode: 'CAD', currencySymbol: 'CA$', locale: 'en-CA', phonePrefix: '+1 ', phonePlaceholder: '+1 (416) 555-0123' },
  MX: { countryCode: 'MX', country: 'Mexico 🇲🇽', region: 'America/North', currencyCode: 'MXN', currencySymbol: 'MX$', locale: 'es-MX', phonePrefix: '+52 ', phonePlaceholder: '+52 55 1234 5678' },
  BR: { countryCode: 'BR', country: 'Brazil 🇧🇷', region: 'America/South', currencyCode: 'BRL', currencySymbol: 'R$', locale: 'pt-BR', phonePrefix: '+55 ', phonePlaceholder: '+55 11 91234-5678' },
  AU: { countryCode: 'AU', country: 'Australia 🇦🇺', region: 'Australia/East', currencyCode: 'AUD', currencySymbol: 'A$', locale: 'en-AU', phonePrefix: '+61 ', phonePlaceholder: '+61 412 345 678' },
  NZ: { countryCode: 'NZ', country: 'New Zealand 🇳🇿', region: 'Pacific/Auckland', currencyCode: 'NZD', currencySymbol: 'NZ$', locale: 'en-NZ', phonePrefix: '+64 ', phonePlaceholder: '+64 21 123 456' },
  JP: { countryCode: 'JP', country: 'Japan 🇯🇵', region: 'Asia/East', currencyCode: 'JPY', currencySymbol: '¥', locale: 'ja-JP', phonePrefix: '+81 ', phonePlaceholder: '+81 90 1234 5678' },
  CN: { countryCode: 'CN', country: 'China 🇨🇳', region: 'Asia/East', currencyCode: 'CNY', currencySymbol: '¥', locale: 'zh-CN', phonePrefix: '+86 ', phonePlaceholder: '+86 138 1234 5678' },
  HK: { countryCode: 'HK', country: 'Hong Kong 🇭🇰', region: 'Asia/East', currencyCode: 'HKD', currencySymbol: 'HK$', locale: 'zh-HK', phonePrefix: '+852 ', phonePlaceholder: '+852 9123 4567' },
  KR: { countryCode: 'KR', country: 'South Korea 🇰🇷', region: 'Asia/East', currencyCode: 'KRW', currencySymbol: '₩', locale: 'ko-KR', phonePrefix: '+82 ', phonePlaceholder: '+82 10 1234 5678' },
  SG: { countryCode: 'SG', country: 'Singapore 🇸🇬', region: 'Asia/Southeast', currencyCode: 'SGD', currencySymbol: 'S$', locale: 'en-SG', phonePrefix: '+65 ', phonePlaceholder: '+65 8123 4567' },
  AE: { countryCode: 'AE', country: 'United Arab Emirates 🇦🇪', region: 'Asia/Gulf', currencyCode: 'AED', currencySymbol: 'د.إ', locale: 'ar-AE', phonePrefix: '+971 ', phonePlaceholder: '+971 50 123 4567' },
  ZA: { countryCode: 'ZA', country: 'South Africa 🇿🇦', region: 'Africa/South', currencyCode: 'ZAR', currencySymbol: 'R', locale: 'en-ZA', phonePrefix: '+27 ', phonePlaceholder: '+27 82 123 4567' }
});

const REGION_TIMEZONE_GROUPS = Object.freeze({
  IN: ['Asia/Kolkata', 'Asia/Calcutta'],
  GB: ['Europe/London', 'Europe/Belfast'],
  IE: ['Europe/Dublin'],
  DE: ['Europe/Berlin', 'Europe/Busingen'],
  FR: ['Europe/Paris'],
  ES: ['Europe/Madrid', 'Atlantic/Canary'],
  IT: ['Europe/Rome'],
  NL: ['Europe/Amsterdam'],
  BE: ['Europe/Brussels'],
  AT: ['Europe/Vienna'],
  PT: ['Europe/Lisbon'],
  GR: ['Europe/Athens'],
  FI: ['Europe/Helsinki'],
  CH: ['Europe/Zurich'],
  PL: ['Europe/Warsaw'],
  SE: ['Europe/Stockholm'],
  NO: ['Europe/Oslo'],
  DK: ['Europe/Copenhagen'],
  US: ['America/New_York', 'America/Detroit', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu', 'America/Indiana/Indianapolis', 'America/Indiana/Chicago', 'America/North_Dakota/Center', 'America/North_Dakota/New_Salem'],
  CA: ['America/Toronto', 'America/Montreal', 'America/Winnipeg', 'America/Regina', 'America/Edmonton', 'America/Vancouver', 'America/Whitehorse', 'America/Halifax', 'America/Glace_Bay', 'America/Goose_Bay', 'America/St_Johns'],
  MX: ['America/Mexico_City', 'America/Monterrey', 'America/Chihuahua', 'America/Tijuana', 'America/Cancun'],
  BR: ['America/Sao_Paulo', 'America/Bahia', 'America/Fortaleza', 'America/Recife', 'America/Manaus', 'America/Cuiaba', 'America/Porto_Velho'],
  AU: ['Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Adelaide', 'Australia/Perth', 'Australia/Darwin', 'Australia/Hobart', 'Australia/Lord_Howe'],
  NZ: ['Pacific/Auckland', 'Pacific/Chatham'],
  JP: ['Asia/Tokyo'],
  CN: ['Asia/Shanghai', 'Asia/Chongqing', 'Asia/Harbin'],
  HK: ['Asia/Hong_Kong'],
  KR: ['Asia/Seoul'],
  SG: ['Asia/Singapore'],
  AE: ['Asia/Dubai'],
  ZA: ['Africa/Johannesburg']
});

const REGION_BY_TIMEZONE = Object.freeze(Object.entries(REGION_TIMEZONE_GROUPS).reduce((result, [countryCode, zones]) => {
  zones.forEach((zone) => { result[zone] = countryCode; });
  return result;
}, {}));

let inMemoryUserSession = null;

const pinChangeState = (() => {
  let currentPin = '';
  let ownerId = '';
  let token = '';
  let expiresAt = 0;

  const clear = () => {
    currentPin = '';
    ownerId = '';
    token = '';
    expiresAt = 0;
  };

  const createToken = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  };

  return {
    issue(pin, userId) {
      clear();
      currentPin = String(pin == null ? '' : pin);
      ownerId = String(userId || '');
      token = createToken();
      expiresAt = Date.now() + 5 * 60 * 1000;
      return token;
    },
    consume(issuedToken, userId) {
      if (!issuedToken || issuedToken !== token || ownerId !== String(userId || '') || Date.now() >= expiresAt) {
        clear();
        return '';
      }
      const pin = currentPin;
      clear();
      return pin;
    },
    clear
  };
})();

const regionDetectionState = {
  requestId: 0,
  controller: null,
  promise: null,
  userId: '',
  listeners: []
};

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

  static isValidPin(pin) {
    return /^\d{4}$/.test(String(pin == null ? '' : pin).trim());
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
        const session = this._toSessionUser(user);
        if (user.sessionIssuedAt) session.sessionIssuedAt = user.sessionIssuedAt;
        if (user.sessionExpiresAt) session.sessionExpiresAt = user.sessionExpiresAt;
        inMemoryUserSession = session;
        this.setUserSession(session);
        return session;
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

    if (!user.countryCode && user.regionSource !== 'manual') {
      Object.assign(user, this.detectRegionAndCurrency(), { regionSource: 'auto' });
      if (!storage.saveUsers(users)) {
        return { success: false, errorType: 'storage', error: 'Local storage is unavailable.' };
      }
    }

    this.clearFailures('login');
    const sessionUser = this._toSessionUser(user);
    this.setUserSession(sessionUser);
    return { success: true, user: sessionUser };
  }

  // ----- Signup -----

  static async signup(name, email, password, pin) {
    const storage = getStorageService();
    const users = storage ? storage.getUsers() : [];
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanPin = String(pin == null ? '' : pin).trim();

    const existing = users.find((u) => u.email && u.email.toLowerCase() === cleanEmail);
    if (existing) {
      return { success: false, error: 'An account with this email address already exists.' };
    }

    if (!password || String(password).length < 6) {
      return { success: false, error: 'Password must be at least 6 characters long.' };
    }

    if (!this.isValidPin(cleanPin)) {
      return { success: false, error: 'Security PIN must be exactly 4 digits.' };
    }

    if (!storage) {
      return { success: false, error: 'Local storage is unavailable.' };
    }

    const regionInfo = this.detectRegionAndCurrency();
    const hashedPin = await this.hashPin(cleanPin);
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
      ...regionInfo,
      regionSource: 'auto',
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    if (!storage.saveUsers(users)) {
      return { success: false, error: 'Could not save the account in local storage.' };
    }

    const sessionUser = this._toSessionUser(newUser);
    this.setUserSession(sessionUser);
    return { success: true, user: sessionUser };
  }

  static _normalizeCountryCode(countryCode) {
    const normalized = String(countryCode || '').trim().toUpperCase();
    return /^[A-Z]{2}$/.test(normalized) ? normalized : '';
  }

  static _normalizeCurrencyCode(currencyCode) {
    const normalized = String(currencyCode || '').trim().toUpperCase();
    return /^[A-Z]{3}$/.test(normalized) ? normalized : '';
  }

  static _countryCodeFromLocale(locale) {
    const normalized = String(locale || '').replace(/_/g, '-');
    const parts = normalized.split('-');
    for (let i = 1; i < parts.length; i++) {
      if (/^[A-Za-z]{2}$/.test(parts[i])) return parts[i].toUpperCase();
    }
    return '';
  }

  static _currencySymbol(currencyCode, locale = 'en-US') {
    const normalizedCode = this._normalizeCurrencyCode(currencyCode);
    if (!normalizedCode) return '';
    try {
      const parts = new Intl.NumberFormat(locale || 'en-US', {
        style: 'currency',
        currency: normalizedCode
      }).formatToParts(1);
      const symbol = parts.find((part) => part.type === 'currency');
      return symbol ? symbol.value : normalizedCode;
    } catch (e) {
      return normalizedCode;
    }
  }

  static _localeFromGeolocation(payload, countryCode) {
    const rawLanguage = payload && (
      payload.locale ||
      payload.language ||
      (Array.isArray(payload.languages) ? payload.languages[0] : '') ||
      (typeof payload.languages === 'string' ? payload.languages.split(',')[0] : '')
    );
    if (rawLanguage) {
      const normalized = String(rawLanguage).trim().replace(/_/g, '-');
      if (normalized) {
        try {
          new Intl.NumberFormat(normalized).format(1);
          return normalized;
        } catch (e) {}
      }
    }

    try {
      if (typeof Intl !== 'undefined' && Intl.Locale && countryCode) {
        return new Intl.Locale(countryCode).toString();
      }
    } catch (e) {}

    return 'en-US';
  }

  static _timeZoneFromGeolocation(payload) {
    const timeZone = payload && (payload.timezone || payload.timeZone || payload.time_zone);
    if (!timeZone || typeof timeZone !== 'string') return '';
    try {
      if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
        new Intl.DateTimeFormat('en-US', { timeZone }).format();
        return timeZone;
      }
    } catch (e) {}
    return '';
  }

  static _regionForCountryCode(countryCode, source = 'fallback', timeZone = '') {
    const normalizedCode = String(countryCode || '').toUpperCase();
    const preset = REGION_PRESETS[normalizedCode] || REGION_PRESETS.US;
    const confidence = source === 'timezone' || source === 'ip'
      ? 'high'
      : source === 'locale'
        ? 'medium'
        : 'low';
    return {
      ...preset,
      countryCode: preset.countryCode,
      timeZone: timeZone || '',
      regionSource: 'auto',
      detectionSource: source,
      detectionConfidence: confidence
    };
  }

  static getAvailableRegions() {
    return Object.keys(REGION_PRESETS).map((countryCode) => ({ ...REGION_PRESETS[countryCode] }));
  }

  static getRegionByCountryCode(countryCode) {
    const preset = REGION_PRESETS[this._normalizeCountryCode(countryCode)];
    return preset ? { ...preset, regionSource: 'manual' } : null;
  }

  static getRegionByCurrencyCode(currencyCode) {
    const normalizedCode = this._normalizeCurrencyCode(currencyCode);
    const match = Object.keys(REGION_PRESETS).find((countryCode) => REGION_PRESETS[countryCode].currencyCode === normalizedCode);
    if (!match) return null;
    return {
      ...REGION_PRESETS[match],
      regionSource: 'currency',
      detectionSource: 'currency',
      detectionConfidence: 'low'
    };
  }

  static getRegionFromGeolocation(payload = {}) {
    if (!payload || typeof payload !== 'object' || payload.error || payload.success === false) return null;

    const countryCode = this._normalizeCountryCode(
      payload.country_code || payload.countryCode || payload.country_code_iso2
    );
    const currencyCode = this._normalizeCurrencyCode(
      payload.currency || payload.currency_code || payload.currencyCode
    );
    if (!countryCode && !currencyCode) return null;

    const preset = countryCode ? REGION_PRESETS[countryCode] : null;
    const resolvedCurrencyCode = currencyCode || (preset && preset.currencyCode);
    if (!resolvedCurrencyCode) return null;

    const locale = preset ? preset.locale : this._localeFromGeolocation(payload, countryCode);
    const countryName = payload.country_name || payload.countryName ||
      (typeof payload.country === 'string' ? payload.country : (payload.country && payload.country.name) || '');
    const detectedRegion = typeof payload.region === 'string' ? payload.region : '';
    const currencySymbol = payload.currency_symbol || payload.currencySymbol ||
      (preset && preset.currencySymbol) || this._currencySymbol(resolvedCurrencyCode, locale);

    return {
      countryCode: countryCode || (preset && preset.countryCode) || '',
      country: preset ? preset.country : (countryName || countryCode || 'Detected region'),
      region: (preset && preset.region) || detectedRegion || 'Detected',
      currencyCode: resolvedCurrencyCode,
      currencySymbol: currencySymbol || resolvedCurrencyCode,
      locale,
      phonePrefix: preset ? preset.phonePrefix : '',
      phonePlaceholder: preset ? preset.phonePlaceholder : '',
      timeZone: this._timeZoneFromGeolocation(payload),
      regionSource: 'auto',
      detectionSource: 'ip',
      detectionConfidence: 'high'
    };
  }

  static _readRegionGeolocationCache() {
    try {
      const raw = localStorage.getItem(REGION_GEOLOCATION_CACHE_KEY);
      if (!raw) return null;
      const cached = JSON.parse(raw);
      const detectedAt = Number(cached && cached.detectedAt);
      if (!cached || !cached.region || !Number.isFinite(detectedAt)) return null;
      const age = Math.max(0, Date.now() - detectedAt);
      if (age > REGION_GEOLOCATION_CACHE_TTL_MS * 30) return null;
      const region = this.getRegionFromGeolocation({
        country_code: cached.region.countryCode,
        country_name: cached.region.country,
         currency: cached.region.currencyCode,
         currency_symbol: cached.region.currencySymbol,
         locale: cached.region.locale,
         timezone: cached.region.timeZone,
         region: cached.region.region
       });

      if (!region) return null;
      return { region, detectedAt, fresh: age <= REGION_GEOLOCATION_CACHE_TTL_MS };
    } catch (e) {
      return null;
    }
  }

  static _writeRegionGeolocationCache(region) {
    try {
      if (!region) return false;
      localStorage.setItem(REGION_GEOLOCATION_CACHE_KEY, JSON.stringify({
        detectedAt: Date.now(),
        region: {
          countryCode: region.countryCode,
          country: region.country,
          region: region.region,
          currencyCode: region.currencyCode,
          currencySymbol: region.currencySymbol,
          locale: region.locale,
          timeZone: region.timeZone
        }
      }));
      return true;
    } catch (e) {
      return false;
    }
  }

  static _geolocationEndpoint() {
    if (typeof window !== 'undefined' && window.SALVIS_GEOLOCATION_ENDPOINT) {
      return String(window.SALVIS_GEOLOCATION_ENDPOINT);
    }
    return REGION_GEOLOCATION_ENDPOINT;
  }

  static async detectRegionFromIp({ force = false, fetcher = null, signal = null } = {}) {
    const cached = this._readRegionGeolocationCache();
    if (cached && cached.fresh && !force) {
      return { ...cached.region, fromCache: true };
    }

    const request = typeof fetcher === 'function'
      ? fetcher
      : (typeof fetch === 'function' ? (...args) => fetch(...args) : null);
    if (!request) return cached ? { ...cached.region, fromCache: true } : null;

    let timedOut = false;
    let rejectCancellation = null;
    let externalAbortHandler = null;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const requestSignal = controller ? controller.signal : signal;
    const cancellation = new Promise((_, reject) => { rejectCancellation = reject; });
    const cancel = () => {
      timedOut = true;
      if (controller) {
        try { controller.abort(); } catch (e) {}
      }
      if (rejectCancellation) {
        const rejection = rejectCancellation;
        rejectCancellation = null;
        rejection(new Error('Geolocation request cancelled.'));
      }
    };
    const timeoutId = setTimeout(cancel, REGION_GEOLOCATION_TIMEOUT_MS);

    if (signal) {
      if (signal.aborted) cancel();
      else if (typeof signal.addEventListener === 'function') {
        externalAbortHandler = () => { cancel(); };
        signal.addEventListener('abort', externalAbortHandler, { once: true });
      }
    }

    const operation = (async () => {
      if (timedOut) throw new Error('Geolocation request cancelled.');
      const response = await request(this._geolocationEndpoint(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
        signal: requestSignal
      });
      if (timedOut || !response || response.ok === false) {
        if (timedOut) throw new Error('Geolocation request cancelled.');
        return cached ? { ...cached.region, fromCache: true } : null;
      }
      if (typeof response.json !== 'function') return cached ? { ...cached.region, fromCache: true } : null;
      const payload = await response.json();
      if (timedOut) throw new Error('Geolocation request cancelled.');
      const region = this.getRegionFromGeolocation(payload);
      if (!region) return cached ? { ...cached.region, fromCache: true } : null;
      this._writeRegionGeolocationCache(region);
      return region;
    })();

    try {
      return await Promise.race([operation, cancellation]);
    } catch (e) {
      return cached ? { ...cached.region, fromCache: true } : null;
    } finally {
      clearTimeout(timeoutId);
      if (signal && externalAbortHandler && typeof signal.removeEventListener === 'function') {
        signal.removeEventListener('abort', externalAbortHandler);
      }
    }
  }

  static async resolveRegionFromIp(options = {}) {
    return this.detectRegionFromIp(options);
  }

  static cancelRegionDetection() {
    regionDetectionState.requestId += 1;
    if (regionDetectionState.controller) {
      try { regionDetectionState.controller.abort(); } catch (e) {}
    }
    regionDetectionState.controller = null;
    regionDetectionState.promise = null;
    regionDetectionState.userId = '';
    regionDetectionState.listeners = [];
  }

  static isRegionDetectionPending(userId = '') {
    return !!regionDetectionState.promise &&
      (!userId || regionDetectionState.userId === String(userId));
  }

  static async refreshRegionFromIp({ force = false, fetcher = null, onUpdate = null } = {}) {
    const user = this.getCurrentUser();
    if (!user || user.regionSource === 'manual') {
      return { updated: false, skipped: true, reason: user ? 'manual' : 'signed-out' };
    }

    const userId = String(user.id);
    if (regionDetectionState.promise && regionDetectionState.userId === userId) {
      if (onUpdate && !regionDetectionState.listeners.includes(onUpdate)) {
        regionDetectionState.listeners.push(onUpdate);
      }
      return regionDetectionState.promise;
    }

    const requestId = ++regionDetectionState.requestId;
    if (regionDetectionState.controller) {
      try { regionDetectionState.controller.abort(); } catch (e) {}
    }
    regionDetectionState.listeners = [];

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    regionDetectionState.controller = controller;
    regionDetectionState.userId = userId;
    if (onUpdate) regionDetectionState.listeners.push(onUpdate);

    const promise = (async () => {
      const detected = await this.detectRegionFromIp({
        force,
        fetcher,
        signal: controller ? controller.signal : null
      });
      if (requestId !== regionDetectionState.requestId) return { updated: false, reason: 'stale' };
      if (!detected) return { updated: false, reason: 'unavailable', user };

      const current = this.getCurrentUser();
      if (!current || String(current.id) !== userId || current.regionSource === 'manual') {
        return { updated: false, reason: 'stale' };
      }

      const fromCache = !!detected.fromCache;
      const updated = await this.updateUserProfile({
        country: detected.country,
        countryCode: detected.countryCode,
        region: detected.region,
        regionSource: 'auto',
        detectionSource: fromCache ? 'ip-cache' : 'ip',
        detectionConfidence: fromCache ? 'medium' : 'high',
        currencyCode: detected.currencyCode,
        currencySymbol: detected.currencySymbol,
        locale: detected.locale,
        phonePrefix: detected.phonePrefix,
        phonePlaceholder: detected.phonePlaceholder,
        timeZone: detected.timeZone,
        regionRequestId: requestId
      });
      if (!updated) return { updated: false, reason: 'stale' };
      return { updated: true, user: updated, region: detected };
    })();

    regionDetectionState.promise = promise;
    let result;
    try {
      result = await promise;
    } catch (e) {
      result = { updated: false, reason: 'error' };
    }

    if (requestId === regionDetectionState.requestId) {
      const listeners = regionDetectionState.listeners.slice();
      regionDetectionState.listeners = [];
      if (regionDetectionState.promise === promise) {
        regionDetectionState.promise = null;
        regionDetectionState.controller = null;
        regionDetectionState.userId = '';
      }
      listeners.forEach((listener) => {
        try { listener(result); } catch (e) {}
      });
    }

    return result;
  }

  static detectRegionAndCurrency(googlePayload = null) {
    let timeZone = '';
    try {
      if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
        timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      }
    } catch (e) {}

    const googleLocale = googlePayload ? (googlePayload.locale || googlePayload.hl || '') : '';
    const browserLocales = typeof navigator !== 'undefined'
      ? (Array.isArray(navigator.languages) && navigator.languages.length ? Array.from(navigator.languages) : [navigator.language || ''])
      : [''];

    let countryCode = REGION_BY_TIMEZONE[timeZone] || '';
    let source = countryCode ? 'timezone' : '';

    if (!countryCode && googleLocale) {
      const googleCode = this._countryCodeFromLocale(googleLocale);
      if (googleCode && REGION_PRESETS[googleCode]) {
        countryCode = googleCode;
        source = 'locale';
      }
    }

    if (!countryCode) {
      for (const locale of browserLocales) {
        countryCode = this._countryCodeFromLocale(locale);
        if (countryCode && REGION_PRESETS[countryCode]) {
          source = 'locale';
          break;
        }
        countryCode = '';
      }
    }

    if (!countryCode || !REGION_PRESETS[countryCode]) {
      return this._regionForCountryCode('US', 'fallback', timeZone);
    }

    return this._regionForCountryCode(countryCode, source, timeZone);
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
    if (!this.isValidPin(passkey)) {
      return { success: false, error: 'Please enter a valid 4-digit Passkey.' };
    }

    const lock = this.checkLockout('pin');
    if (lock.locked) return { success: false, locked: true, remainingMs: lock.remainingMs };

    const user = this.findUserByEmail(email);
    if (!user) return { success: false, error: 'User account not found in database.' };

    const stored = String(user.passkey || user.pin || '').trim();
    const ok = await this.matchesStoredHash(stored, passkey, 'pin');
    if (ok) {
      this.clearFailures('pin');
      this.setUserSession(this._toSessionUser(user));
      return { success: true, user };
    }
    this.recordFailure('pin');
    const lockCheck = this.checkLockout('pin');
    if (lockCheck.locked) return { success: false, locked: true, remainingMs: lockCheck.remainingMs };
    return { success: false, error: 'Incorrect 4-digit Passkey. Please try again.' };
  }

  // ----- New user registration (google onboarding) -----

  static async registerNewUserWithPasskey({ name, email, phone = '', password = '', passkey, avatar, payload = null, regionInfo = null, salvisId = null }) {
    const storage = getStorageService();
    const users = storage ? storage.getUsers() : [];
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanPhone = String(phone || '').trim();
    const cleanPasskey = String(passkey == null ? '' : passkey).trim();
    const phoneDigits = cleanPhone.replace(/\D/g, '');

    if (!storage) {
      return { success: false, error: 'Local storage is unavailable.' };
    }
    if (phoneDigits.length < 7) {
      return { success: false, error: 'Enter a valid phone number including the country code.' };
    }
    if (!this.isValidPin(cleanPasskey)) {
      return { success: false, error: 'Security Passkey must be exactly 4 digits.' };
    }
    if (password && String(password).length < 6) {
      return { success: false, error: 'Password must be at least 6 characters long.' };
    }

    const resolvedRegionInfo = regionInfo || this.detectRegionAndCurrency(payload);
    const hashedPasskey = await this.hashPin(cleanPasskey);
    const existing = users.find((u) => u.email && u.email.toLowerCase() === cleanEmail);

    if (existing) {
      existing.phone = cleanPhone;
      if (password) existing.password = await this.hashPassword(String(password).trim());
      existing.passkey = hashedPasskey;
      existing.pin = hashedPasskey;
      existing.isSecurityOnboarded = true;
      if (!existing.countryCode && existing.regionSource !== 'manual') {
        Object.assign(existing, resolvedRegionInfo, { regionSource: 'auto' });
      }
      if (!storage.saveUsers(users)) {
        return { success: false, error: 'Could not save the account in local storage.' };
      }
      const sessionUser = this._toSessionUser(existing);
      this.setUserSession(sessionUser);
      return { success: true, user: sessionUser, isNew: false };
    }

    const cleanName = name || 'Salvis User';
    const newUser = {
      id: 'usr-g-' + Date.now(),
      salvisId: salvisId || this.generateSalvisId(),
      name: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      password: password ? await this.hashPassword(String(password).trim()) : '',
      passkey: hashedPasskey,
      pin: hashedPasskey,
      avatar: avatar || '🌐',
      nickname: '@' + cleanName.toLowerCase().replace(/[^a-z0-9]/g, ''),
      isSecurityOnboarded: true,
      ...resolvedRegionInfo,
      regionSource: 'auto',
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    if (!storage.saveUsers(users)) {
      return { success: false, error: 'Could not save the account in local storage.' };
    }

    const sessionUser = this._toSessionUser(newUser);
    this.setUserSession(sessionUser);
    return { success: true, user: sessionUser, isNew: true };
  }

  // ----- Google OAuth login -----

  static async loginWithGoogle(customName, customEmail, customAvatar, googlePayload = null) {
    const storage = getStorageService();
    if (!storage) return { success: false, error: 'Local storage is unavailable.' };
    const users = storage.getUsers();

    const googleEmail = String(customEmail || '').trim().toLowerCase();
    if (!googleEmail || !googleEmail.includes('@')) {
      return { success: false, error: 'A verified Google email is required.' };
    }
    const googleName = customName || 'Google Savings User';
    const googleAvatar = customAvatar || '🌐';
    const regionInfo = this.detectRegionAndCurrency(googlePayload);

    const user = users.find((u) => u.email && u.email.toLowerCase() === googleEmail);
    if (!user) {
      return { success: false, error: 'Complete Google onboarding to create an account.' };
    }

    if (!user.salvisId) user.salvisId = this.generateSalvisId();
    user.name = googleName || user.name;
    user.avatar = googleAvatar || user.avatar;
    if (!user.countryCode && user.regionSource !== 'manual') {
      Object.assign(user, regionInfo, { regionSource: 'auto' });
    }

    if (!storage.saveUsers(users)) {
      return { success: false, error: 'Could not save the account in local storage.' };
    }

    const sessionUser = this._toSessionUser(user);
    this.setUserSession(sessionUser);
    return { success: true, user: sessionUser };
  }

  static async updateUserProfile({ name, nickname, phone, password, avatar, isOnboarded, isSecurityOnboarded, country, countryCode, region, regionSource, detectionSource, detectionConfidence, currencyCode, currencySymbol, locale, phonePrefix, phonePlaceholder, timeZone, regionRequestId = null }) {
    const session = this.getCurrentUser();
    if (!session) return null;
    if (regionRequestId !== null && regionRequestId !== regionDetectionState.requestId) return null;
    if (regionSource === 'manual') this.cancelRegionDetection();

    const storage = getStorageService();
    if (!storage) return null;

    const users = storage.getUsers();
    const idx = users.findIndex((u) => u.id === session.id);
    const rec = idx >= 0 ? users[idx] : { ...session };

    if (name !== undefined) rec.name = String(name).trim() || rec.name;
    if (nickname !== undefined && nickname) rec.nickname = String(nickname).trim();
    if (phone !== undefined) rec.phone = String(phone).trim();
    if (password !== undefined && String(password).length > 0) rec.password = await this.hashPassword(String(password));
    if (avatar !== undefined) rec.avatar = avatar;
    if (isOnboarded !== undefined) rec.isOnboarded = isOnboarded;
    if (isSecurityOnboarded !== undefined) rec.isSecurityOnboarded = isSecurityOnboarded;
    if (country !== undefined) rec.country = country;
    if (countryCode !== undefined) rec.countryCode = String(countryCode).toUpperCase();
    if (region !== undefined) rec.region = region;
    if (regionSource !== undefined) rec.regionSource = regionSource;
    if (detectionSource !== undefined) rec.detectionSource = detectionSource;
    if (detectionConfidence !== undefined) rec.detectionConfidence = detectionConfidence;
    if (currencyCode !== undefined) rec.currencyCode = currencyCode;
    if (currencySymbol !== undefined) rec.currencySymbol = currencySymbol;
    if (locale !== undefined) rec.locale = locale;
    if (phonePrefix !== undefined) rec.phonePrefix = phonePrefix;
    if (phonePlaceholder !== undefined) rec.phonePlaceholder = phonePlaceholder;
    if (timeZone !== undefined) rec.timeZone = timeZone;
    if (regionRequestId !== null && regionRequestId !== regionDetectionState.requestId) return null;

    if (idx >= 0) users[idx] = rec;
    else users.push(rec);
    if (!storage.saveUsers(users)) return null;

    const newSession = this._toSessionUser(rec);
    if (session.sessionIssuedAt) newSession.sessionIssuedAt = session.sessionIssuedAt;
    if (session.sessionExpiresAt) newSession.sessionExpiresAt = session.sessionExpiresAt;
    this.setUserSession(newSession);
    return newSession;
  }

  static beginPinChange(currentPin) {
    if (!this.isValidPin(currentPin)) return null;
    const session = this.getCurrentUser();
    if (!session) return null;
    return pinChangeState.issue(currentPin, session.id);
  }

  static cancelPinChange() {
    pinChangeState.clear();
  }

  static async completePinChange(token, newPin) {
    if (!this.isValidPin(newPin)) {
      return { success: false, error: 'New PIN must be exactly 4 digits.' };
    }
    const session = this.getCurrentUser();
    if (!session) {
      pinChangeState.clear();
      return { success: false, error: 'No active session.' };
    }
    const currentPin = pinChangeState.consume(token, session.id);
    if (!currentPin) {
      return { success: false, error: 'PIN verification expired. Verify your current PIN again.' };
    }
    return this.changePin(currentPin, newPin);
  }

  static async changePin(currentPin, newPin) {
    const cleanCurrentPin = String(currentPin == null ? '' : currentPin).trim();
    const cleanNewPin = String(newPin == null ? '' : newPin).trim();

    if (!this.isValidPin(cleanCurrentPin)) {
      return { success: false, error: 'Please enter a valid 4-digit current PIN.' };
    }
    if (!this.isValidPin(cleanNewPin)) {
      return { success: false, error: 'New PIN must be exactly 4 digits.' };
    }
    if (cleanCurrentPin === cleanNewPin) {
      return { success: false, error: 'New PIN must be different from the current PIN.' };
    }

    const lock = this.checkLockout('pin');
    if (lock.locked) return { success: false, locked: true, remainingMs: lock.remainingMs };

    const session = this.getCurrentUser();
    if (!session) return { success: false, error: 'No active session.' };

    const storage = getStorageService();
    if (!storage) return { success: false, error: 'Local storage is unavailable.' };

    const users = storage.getUsers();
    const idx = users.findIndex((u) => u.id === session.id);
    const rec = idx >= 0 ? users[idx] : null;
    if (!rec) return { success: false, error: 'User account not found.' };

    const stored = String(rec.pin || rec.passkey || '').trim();
    if (!stored) return { success: false, error: 'No Security PIN configured.' };

    const currentMatches = await this.matchesStoredHash(stored, cleanCurrentPin, 'pin');
    if (!currentMatches) {
      this.recordFailure('pin');
      const lockCheck = this.checkLockout('pin');
      if (lockCheck.locked) return { success: false, locked: true, remainingMs: lockCheck.remainingMs };
      return { success: false, error: 'Incorrect current PIN.' };
    }

    this.clearFailures('pin');
    const newHash = await this.hashPin(cleanNewPin);
    rec.pin = newHash;
    rec.passkey = newHash;
    if (!storage.saveUsers(users)) {
      return { success: false, error: 'Could not save the new PIN in local storage.' };
    }

    const newSession = this._toSessionUser(rec);
    if (session.sessionIssuedAt) newSession.sessionIssuedAt = session.sessionIssuedAt;
    if (session.sessionExpiresAt) newSession.sessionExpiresAt = session.sessionExpiresAt;
    this.setUserSession(newSession);
    return { success: true, user: newSession };
  }

  // ----- PIN -----

  static async verifyPin(enteredPin) {
    if (!this.isValidPin(enteredPin)) {
      return { success: false, error: 'Please enter a valid 4-digit PIN.' };
    }
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
    const hasExplicitCountry = !!user.countryCode;
    const hasExplicitRegion = hasExplicitCountry || !!user.currencyCode;
    const detected = hasExplicitRegion ? null : this.detectRegionAndCurrency();
    const explicit = hasExplicitCountry ? this.getRegionByCountryCode(user.countryCode) : null;
    const countryCode = String(user.countryCode || (detected && detected.countryCode) || '').toUpperCase();
    const country = hasExplicitRegion
      ? (user.country || (explicit && explicit.country) || countryCode || 'Detected region')
      : ((detected && detected.country) || user.country || countryCode || 'Detected region');
    const region = hasExplicitRegion
      ? (user.region || (explicit && explicit.region) || 'Detected')
      : ((detected && detected.region) || user.region || 'Detected');
    const currencyCode = hasExplicitRegion
      ? (user.currencyCode || (explicit && explicit.currencyCode) || (detected && detected.currencyCode) || 'USD')
      : ((detected && detected.currencyCode) || user.currencyCode || 'USD');
    const locale = hasExplicitRegion
      ? (user.locale || (explicit && explicit.locale) || this._localeFromGeolocation({}, countryCode))
      : ((detected && detected.locale) || user.locale || 'en-US');
    const currencySymbol = user.currencySymbol ||
      (explicit && explicit.currencySymbol) ||
      (hasExplicitRegion ? this._currencySymbol(currencyCode, locale) : ((detected && detected.currencySymbol) || this._currencySymbol(currencyCode, locale)));
    const regionSource = hasExplicitRegion ? (user.regionSource || 'auto') : 'auto';
    const detectionSource = hasExplicitRegion
      ? (user.detectionSource || '')
      : ((detected && detected.detectionSource) || user.detectionSource || '');
    const detectionConfidence = hasExplicitRegion
      ? (user.detectionConfidence || '')
      : ((detected && detected.detectionConfidence) || user.detectionConfidence || '');
    const timeZone = user.timeZone || (explicit && explicit.timeZone) || (detected && detected.timeZone) || '';
    const phonePrefix = user.phonePrefix ||
      (explicit && explicit.phonePrefix) ||
      (hasExplicitRegion ? '' : ((detected && detected.phonePrefix) || '+1 '));
    const phonePlaceholder = user.phonePlaceholder ||
      (explicit && explicit.phonePlaceholder) ||
      (hasExplicitRegion ? '' : ((detected && detected.phonePlaceholder) || '+1 (555) 234-5678'));

    return {
      id: user.id,
      salvisId: user.salvisId || user.id,
      name: user.name || 'Savings User',
      email: user.email || '',
      phone: user.phone || '',
      avatar: user.avatar || '👤',
      country,
      countryCode,
      region,
      regionSource,
      detectionSource,
      detectionConfidence,
      currencyCode,
      currencySymbol,
      locale,
      timeZone,
      phonePrefix,
      phonePlaceholder,
      nickname: user.nickname || '@' + String(user.name || 'user').toLowerCase().replace(/[^a-z0-9]/g, ''),
      isSecurityOnboarded: !!(user.isSecurityOnboarded || user.isOnboarded),
      sessionIssuedAt: Date.now(),
      sessionExpiresAt: Date.now() + SESSION_TTL_MS
    };
  }

  static setUserSession(user) {
    const toStore = user.sessionExpiresAt ? user : this._toSessionUser(user);
    if (inMemoryUserSession && inMemoryUserSession.id !== toStore.id) {
      this.cancelRegionDetection();
      pinChangeState.clear();
    }
    inMemoryUserSession = toStore;
    try {
      localStorage.setItem(AUTH_KEYS.CURRENT_USER, JSON.stringify(toStore));
      localStorage.setItem(AUTH_KEYS.LEGACY_USER, JSON.stringify(toStore));
    } catch (e) {}
  }

  static logout() {
    this.cancelRegionDetection();
    inMemoryUserSession = null;
    pinChangeState.clear();
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