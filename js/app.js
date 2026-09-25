/**
 * Application Main Entry Point & Page Router (Universal Browser Compatible)
 */

/* ==========================================================================
   OFFICIAL GOOGLE OAUTH 2.0 CLIENT ENGINE
   ========================================================================== */

const GOOGLE_CLIENT_ID = "336079462676-rrr0adbpjv3fbt9tv3dulu3f6k526pbt.apps.googleusercontent.com";
let pendingPinChangeToken = '';

function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
}

window.handleGoogleCredentialResponse = function(response) {
  if (!response || !response.credential) return;
  const payload = parseJwt(response.credential);
  if (payload && payload.email) {
    const name = payload.name || payload.given_name || payload.email.split('@')[0];
    const email = payload.email;
    const avatar = payload.picture || '🌐';
        processGoogleAuthFlow(name, email, avatar, payload, true);
  }
};

window.initGoogleGIS = function() {
  let attempts = 0;
  const maxAttempts = 12;

  const tryInit = () => {
    attempts++;
    const container = document.getElementById('googleGsiBtnContainer');

    if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
      try {
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: window.handleGoogleCredentialResponse,
          auto_select: false,
          cancel_on_tap_outside: true
        });

        if (container) {
          container.innerHTML = '';
          google.accounts.id.renderButton(container, {
            theme: 'outline',
            size: 'large',
            width: '320',
            text: 'continue_with',
            shape: 'rectangular',
            logo_alignment: 'center'
          });
          container.style.display = 'flex';
          container.style.justifyContent = 'center';
          container.style.alignItems = 'center';
        }

        if (window.location.protocol.startsWith('http')) {
          google.accounts.id.prompt((notification) => {
            if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
              console.log('Google One-Tap status:', notification.getNotDisplayedReason() || notification.getSkippedReason());
            }
          });
        }
        return;
      } catch (err) {
        console.warn('Google GSI initialization notice:', err);
      }
    }

    if (attempts < maxAttempts) {
      setTimeout(tryInit, 300);
    }
  };

  tryInit();
};

window.togglePasswordVisibility = function(inputId, btnEl) {
  const input = document.getElementById(inputId);
  if (!input) return;

  if (input.type === 'password') {
    input.type = 'text';
    if (btnEl) {
      btnEl.innerHTML = '🙈';
      btnEl.setAttribute('aria-label', 'Hide Password');
    }
  } else {
    input.type = 'password';
    if (btnEl) {
      btnEl.innerHTML = '👁️';
      btnEl.setAttribute('aria-label', 'Show Password');
    }
  }
};

window.checkPasswordRequirements = function(pw) {
  const pwStr = pw || '';
  
  const hasLen = pwStr.length >= 8;
  const hasUpper = /[A-Z]/.test(pwStr);
  const hasNum = /[0-9]/.test(pwStr);
  const hasSpec = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pwStr);

  const elLen = document.getElementById('pwReqLen');
  const elUpper = document.getElementById('pwReqUpper');
  const elNum = document.getElementById('pwReqNum');
  const elSpec = document.getElementById('pwReqSpec');

  if (elLen) {
    elLen.textContent = `${hasLen ? '✅' : '❌'} At least 8 characters long`;
    elLen.style.color = hasLen ? 'var(--accent-emerald)' : 'var(--text-secondary)';
  }
  if (elUpper) {
    elUpper.textContent = `${hasUpper ? '✅' : '❌'} At least 1 uppercase letter (A-Z)`;
    elUpper.style.color = hasUpper ? 'var(--accent-emerald)' : 'var(--text-secondary)';
  }
  if (elNum) {
    elNum.textContent = `${hasNum ? '✅' : '❌'} At least 1 number (0-9)`;
    elNum.style.color = hasNum ? 'var(--accent-emerald)' : 'var(--text-secondary)';
  }
  if (elSpec) {
    elSpec.textContent = `${hasSpec ? '✅' : '❌'} At least 1 special character (!@#$%^&*)`;
    elSpec.style.color = hasSpec ? 'var(--accent-emerald)' : 'var(--text-secondary)';
  }

  return hasLen && hasUpper && hasNum && hasSpec;
};

window.triggerGoogleSignIn = function() {
  const storage = typeof StorageService !== 'undefined' ? StorageService : window.StorageService;
  const ui = typeof UIRenderer !== 'undefined' ? UIRenderer : window.UIRenderer;
  if (storage) storage.init();

  if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
    try {
      google.accounts.id.prompt();
      return;
    } catch (e) {}
  }

  if (ui && typeof ui.showToast === 'function') {
    ui.showToast('Google sign-in is unavailable. Please use password sign-in or signup.', 'warning');
  }
};






window.checkGoogleOAuthCallback = function() {
  const hash = window.location.hash || '';
  const search = window.location.search || '';

  if (hash.includes('access_token') || hash.includes('id_token')) {
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const idToken = params.get('id_token');
    const accessToken = params.get('access_token');

    if (idToken) {
      const payload = parseJwt(idToken);
      if (payload && payload.email) {
        const name = payload.name || payload.email.split('@')[0];
        const email = payload.email;
        const avatar = payload.picture || '🌐';
        
        window.history.replaceState(null, document.title, window.location.pathname);
    processGoogleAuthFlow(name, email, avatar, payload, true);
        return;
      }
    }

    if (accessToken) {
      fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      })
      .then(res => res.json())
      .then(user => {
        if (user && user.email) {
          window.history.replaceState(null, document.title, window.location.pathname);
          processGoogleAuthFlow(user.name || user.email.split('@')[0], user.email, user.picture || '🌐', user, true);
        }
      })
      .catch(err => {
        console.warn('OAuth UserInfo error:', err);
      });
      return;
    }
  }

  if (search.includes('error=redirect_uri_mismatch') || search.includes('error=')) {
    const ui = typeof UIRenderer !== 'undefined' ? UIRenderer : window.UIRenderer;
    if (ui) {
      ui.showToast('Google OAuth: Redirect URI needs registration in Google Cloud Console', 'warning');
    }
  }
};

window.selectGoogleAccount = async function(name, email) {
  const auth = typeof AuthService !== 'undefined' ? AuthService : window.AuthService;
  const ui = typeof UIRenderer !== 'undefined' ? UIRenderer : window.UIRenderer;
  if (!auth) return;

  const result = await auth.loginWithGoogle(name, email, '🌐', {});
  if (!result || !result.success) {
    if (ui) ui.showToast((result && result.error) || 'Google sign-in could not be completed.', 'error');
    return;
  }

  window.openDashboardPage();
  if (ui) {
    ui.checkAuthState();
    ui.showToast(`Welcome, ${name}! Signed in via Google 🌐`);
  }
};

window.pendingAuthPayload = null;

window.showAuthLoginView = function() {
  window.pendingRegionDetectionToken = (window.pendingRegionDetectionToken || 0) + 1;
  window.pendingAuthPayload = null;

  const defaultView = document.getElementById('authDefaultLoginView');
  const signupBox = document.getElementById('signupBox');
  const existingBox = document.getElementById('existingUserPasskeyBox');
  const newBox = document.getElementById('newUserPasskeyBox');

  if (defaultView) defaultView.style.display = 'block';
  if (signupBox) signupBox.style.display = 'none';
  if (existingBox) existingBox.style.display = 'none';
  if (newBox) newBox.style.display = 'none';
};

window.showExistingUserPasskeyView = function(user) {
  if (!user) return;
  window.pendingRegionDetectionToken = (window.pendingRegionDetectionToken || 0) + 1;
  window.pendingAuthPayload = user;

  const defaultView = document.getElementById('authDefaultLoginView');
  const signupBox = document.getElementById('signupBox');
  const existingBox = document.getElementById('existingUserPasskeyBox');
  const newBox = document.getElementById('newUserPasskeyBox');

  if (defaultView) defaultView.style.display = 'none';
  if (signupBox) signupBox.style.display = 'none';
  if (newBox) newBox.style.display = 'none';
  if (existingBox) existingBox.style.display = 'block';

  const avatarDisp = document.getElementById('existingUserAvatar');
  const nameDisp = document.getElementById('existingUserName');
  const emailDisp = document.getElementById('existingUserEmail');
  const idDisp = document.getElementById('existingUserSalvisId');
  const input = document.getElementById('existingUserPasskeyInput');

  if (avatarDisp) {
    if (user.avatar && (user.avatar.startsWith('http://') || user.avatar.startsWith('https://'))) {
      avatarDisp.innerHTML = `<img src="${user.avatar}" alt="User Avatar" style="width: 100%; height: 100%; object-fit: cover;">`;
    } else {
      avatarDisp.textContent = user.avatar || '👋';
    }
  }

  if (nameDisp) nameDisp.textContent = user.name || 'Returning User';
  if (emailDisp) emailDisp.textContent = user.email || 'user@example.com';
  if (idDisp) idDisp.textContent = `ID: ${user.salvisId || 'SALVIS-USER'}`;
  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 100);
  }
};

window.showNewUserPasskeyView = function({ name, email, avatar, payload, googleVerified = false }) {
  const auth = typeof AuthService !== 'undefined' ? AuthService : window.AuthService;
  const initialRegion = auth ? auth.detectRegionAndCurrency(payload) : {
    country: 'Detecting region',
    countryCode: '',
    region: 'Detected',
    currencyCode: '',
    currencySymbol: '',
    locale: 'en-US',
    phonePrefix: '',
    phonePlaceholder: 'Enter your phone number'
  };
  const tempSalvisId = auth ? auth.generateSalvisId() : 'SALVIS-' + Math.floor(100000 + Math.random() * 900000);
  const detectionToken = (window.pendingRegionDetectionToken || 0) + 1;
  window.pendingRegionDetectionToken = detectionToken;
  window.pendingAuthPayload = { name, email, avatar, payload, tempSalvisId, googleVerified, regionInfo: initialRegion };

  const defaultView = document.getElementById('authDefaultLoginView');
  const signupBox = document.getElementById('signupBox');
  const existingBox = document.getElementById('existingUserPasskeyBox');
  const newBox = document.getElementById('newUserPasskeyBox');

  if (defaultView) defaultView.style.display = 'none';
  if (signupBox) signupBox.style.display = 'none';
  if (existingBox) existingBox.style.display = 'none';
  if (newBox) newBox.style.display = 'block';

  const badge = document.getElementById('newSalvisIdBadge');
  const avatarDisp = document.getElementById('newUserAvatar');
  const nameDisp = document.getElementById('newUserName');
  const emailDisp = document.getElementById('newUserEmail');
  const regionBadge = document.getElementById('newUserRegionBadge');
  const input = document.getElementById('newUserPasskeyInput');
  const phoneInput = document.getElementById('newUserPhoneInput');

  if (badge) badge.textContent = tempSalvisId;
  if (avatarDisp) {
    if (avatar && (avatar.startsWith('http://') || avatar.startsWith('https://'))) {
      avatarDisp.innerHTML = `<img src="${avatar}" alt="New User" style="width: 100%; height: 100%; object-fit: cover;">`;
    } else {
      avatarDisp.textContent = avatar || '🌐';
    }
  }

  if (nameDisp) nameDisp.textContent = name || 'New Savings User';
  if (emailDisp) emailDisp.textContent = email || 'newuser@example.com';

  if (phoneInput) {
    phoneInput.value = initialRegion.phonePrefix || '';
    phoneInput.placeholder = initialRegion.phonePlaceholder || 'Enter your phone number';
    phoneInput.dataset.autoRegion = 'true';
    phoneInput.oninput = () => { phoneInput.dataset.autoRegion = 'false'; };
  }

  const renderRegion = (regionInfo) => {
    if (!regionInfo ||
      window.pendingRegionDetectionToken !== detectionToken ||
      !window.pendingAuthPayload ||
      window.pendingAuthPayload.email !== email) return;
    window.pendingAuthPayload.regionInfo = regionInfo;
    if (regionBadge) {
      regionBadge.textContent = `${regionInfo.country} (${regionInfo.currencyCode} ${regionInfo.currencySymbol})`;
    }
    if (phoneInput && phoneInput.dataset.autoRegion === 'true') {
      phoneInput.value = regionInfo.phonePrefix || '';
      phoneInput.placeholder = regionInfo.phonePlaceholder || 'Enter your phone number';
    }
  };

  renderRegion(initialRegion);

  if (auth && typeof auth.detectRegionFromIp === 'function') {
    auth.detectRegionFromIp().then((regionInfo) => {
      renderRegion(regionInfo);
    }).catch(() => {});
  }

  if (input) {
    input.value = '';
    setTimeout(() => {
      if (phoneInput) {
        phoneInput.focus();
        phoneInput.setSelectionRange(phoneInput.value.length, phoneInput.value.length);
      } else {
        input.focus();
      }
    }, 100);
  }
};

window.showInputError = function(inputId, errorMsgId, message) {
  if (arguments.length === 2) {
    message = errorMsgId;
    errorMsgId = inputId + 'Error';
  }
  if (!errorMsgId) {
    errorMsgId = inputId + 'Error';
  }

  const input = document.getElementById(inputId);
  const msgEl = document.getElementById(errorMsgId);

  if (input) {
    input.classList.remove('input-error');
    void input.offsetWidth; // Force reflow to restart CSS shake animation
    input.classList.add('input-error');
    input.focus();
    if (typeof input.select === 'function') {
      try { input.select(); } catch(e) {}
    }
  }

  if (msgEl) {
    msgEl.innerHTML = `<span>❌</span> <span>${message || 'Incorrect details. Please try again.'}</span>`;
    msgEl.style.display = 'flex';
  }
};

window.clearInputError = function(inputId, errorMsgId) {
  if (!errorMsgId) {
    errorMsgId = inputId + 'Error';
  }

  const input = document.getElementById(inputId);
  const msgEl = document.getElementById(errorMsgId);

  if (input) {
    input.classList.remove('input-error');
  }

  if (msgEl) {
    msgEl.style.display = 'none';
    msgEl.innerHTML = '';
  }
};

window.submitExistingUserPasskey = async function(e) {
  if (e && e.preventDefault) e.preventDefault();

  const auth = typeof AuthService !== 'undefined' ? AuthService : window.AuthService;
  const ui = typeof UIRenderer !== 'undefined' ? UIRenderer : window.UIRenderer;

  const input = document.getElementById('existingUserPasskeyInput');
  const passkey = input ? input.value.trim() : '';

  if (!passkey || passkey.length !== 4 || isNaN(passkey)) {
    window.showInputError('existingUserPasskeyInput', 'existingPasskeyErrorMsg', 'Please enter your 4-digit numeric Passkey.');
    if (ui) ui.showToast('Please enter your 4-digit numeric Passkey 🔑', 'warning');
    return;
  }

  const user = window.pendingAuthPayload;
  if (!user || !user.email) return;

  if (auth) {
    const res = await auth.verifyPasskey(user.email, passkey);
    if (res.success) {
      window.clearInputError('existingUserPasskeyInput', 'existingPasskeyErrorMsg');
      window.openDashboardPage();
      if (ui) {
        ui.checkAuthState();
        ui.showToast(`Welcome back, ${res.user.name}! 🏦 Vault Unlocked`, 'success');
      }
    } else {
      window.showInputError('existingUserPasskeyInput', 'existingPasskeyErrorMsg', res.error || 'Incorrect Passkey! Access Denied.');
      if (ui) ui.showToast(res.error || 'Incorrect Passkey. Please try again 🔐', 'warning');
    }
  }
};

window.submitNewUserPasskey = async function(e) {
  if (e && e.preventDefault) e.preventDefault();

  const auth = typeof AuthService !== 'undefined' ? AuthService : window.AuthService;
  const ui = typeof UIRenderer !== 'undefined' ? UIRenderer : window.UIRenderer;

  const phoneInput = document.getElementById('newUserPhoneInput');
  const passwordInput = document.getElementById('newUserPasswordInput');
  const passkeyInput = document.getElementById('newUserPasskeyInput');

  const phone = phoneInput ? phoneInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value.trim() : '';
  const passkey = passkeyInput ? passkeyInput.value.trim() : '';

  if (!phone || phone.replace(/\D/g, '').length < 7) {
    if (ui) ui.showToast('Please enter a valid phone number including the country code 📱', 'warning');
    if (phoneInput) phoneInput.focus();
    return;
  }

  if (!password || password.length < 6) {
    if (ui) ui.showToast('Password must be at least 6 characters long 🔐', 'warning');
    if (passwordInput) passwordInput.focus();
    return;
  }

  if (!passkey || passkey.length !== 4 || isNaN(passkey)) {
    if (ui) ui.showToast('Please create a valid 4-digit numeric Passkey 🔑', 'warning');
    if (passkeyInput) passkeyInput.focus();
    return;
  }

  const payloadData = window.pendingAuthPayload;
  if (!payloadData || !payloadData.email) return;
  if (!payloadData.googleVerified) {
    if (ui) ui.showToast('Use the official Google sign-in button to create an account.', 'error');
    return;
  }

  if (auth) {
    const res = await auth.registerNewUserWithPasskey({
      name: payloadData.name,
      email: payloadData.email,
      phone: phone,
      password: password,
      passkey: passkey,
      avatar: payloadData.avatar,
      payload: payloadData.payload,
      regionInfo: payloadData.regionInfo,
      salvisId: payloadData.tempSalvisId
    });

    if (res && res.success) {
      window.openDashboardPage();
      if (ui) {
        ui.checkAuthState();
        ui.showToast(`Welcome to Salvis, ${res.user.name}! Your account (${res.user.salvisId}) has been created 🚀`, 'success');
      }
    } else if (ui) {
      ui.showToast((res && res.error) || 'Could not create the account. Please try again.', 'error');
    }
  }
};

function processGoogleAuthFlow(name, email, avatar, payload, googleVerified = false) {
  const auth = typeof AuthService !== 'undefined' ? AuthService : window.AuthService;

  if (auth) {
    const existing = auth.findUserByEmail(email);
    if (existing) {
      // OLD USER: SHOW PASSKEY PROMPT FOR EXISTING USER
      window.showExistingUserPasskeyView(existing);
    } else {
      // NEW USER: SHOW NEW SALVIS ID & PASSKEY CREATION PROMPT
      window.showNewUserPasskeyView({ name, email, avatar, payload, googleVerified });
    }
  }
}

















window.clearDatabaseAccounts = function() {
  const storage = typeof StorageService !== 'undefined' ? StorageService : window.StorageService;
  const auth = typeof AuthService !== 'undefined' ? AuthService : window.AuthService;
  
  if (auth && typeof auth.logout === 'function') {
    auth.logout();
  }
  
  if (storage && typeof storage.clearAllDatabase === 'function') {
    storage.clearAllDatabase();
  }

  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch (e) {}

  window.location.reload();
};

/* ==========================================================================
   THEME & BASE CONTROLLERS
   ========================================================================== */

window.initAppTheme = function() {
  let theme = localStorage.getItem('salvis_theme');
  if (!theme) {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeWidgetUI(theme);
};

window.toggleAppTheme = function() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('salvis_theme', newTheme);
  updateThemeWidgetUI(newTheme);


  const ui = typeof UIRenderer !== 'undefined' ? UIRenderer : window.UIRenderer;
  if (ui && ui.renderChart) {
    try { ui.renderChart(); } catch(e) {}
  }
  if (ui && ui.showToast) {
    ui.showToast(`Switched to ${newTheme === 'dark' ? '🌙 Dark Mode' : '☀️ Light Mode'}`);
  }
};

function updateThemeWidgetUI(theme) {
  const iconEl = document.getElementById('themeToggleIcon');
  const labelEl = document.getElementById('themeToggleLabel');
  if (iconEl) iconEl.textContent = theme === 'dark' ? '☀️' : '🌙';
  if (labelEl) labelEl.textContent = theme === 'dark' ? 'Light' : 'Dark';
}

window.submitGoogleOnboarding = async function() {
  const nicknameEl = document.getElementById('onboardNicknameInput');
  const phoneEl = document.getElementById('onboardPhoneInput');
  const passEl = document.getElementById('onboardPasswordInput');
  const confirmEl = document.getElementById('onboardConfirmPasswordInput');

  const nickname = nicknameEl ? nicknameEl.value.trim() : '';
  const phone = phoneEl ? phoneEl.value.trim() : '';
  const pass = passEl ? passEl.value : '';
  const confirmPass = confirmEl ? confirmEl.value : '';

  const ui = typeof UIRenderer !== 'undefined' ? UIRenderer : window.UIRenderer;
  const auth = typeof AuthService !== 'undefined' ? AuthService : window.AuthService;

  if (!nickname) {
    if (ui) ui.showToast('Please enter a nickname/username', 'error');
    return;
  }
  if (!phone || phone.replace(/\D/g, '').length < 7) {
    if (ui) ui.showToast('Please enter a valid phone number including the country code', 'error');
    return;
  }
  if (!window.checkPasswordRequirements(pass)) {
    if (ui) ui.showToast('Password does not meet all 4 security requirements', 'error');
    return;
  }
  if (pass !== confirmPass) {
    if (ui) ui.showToast('Passwords do not match', 'error');
    return;
  }

  const currentUser = auth ? auth.getCurrentUser() : null;
  if (!currentUser || !auth || typeof auth.updateUserProfile !== 'function') {
    if (ui) ui.showToast('No active account session. Please sign in again.', 'error');
    return;
  }
  if (!window.pendingAuthPayload || !window.pendingAuthPayload.googleVerified) {
    if (ui) ui.showToast('Use the official Google sign-in button to create an account.', 'error');
    return;
  }

  const updatedUser = await auth.updateUserProfile({ nickname, phone, password: pass, isSecurityOnboarded: true });
  if (!updatedUser) {
    if (ui) ui.showToast('Could not save onboarding details. Please try again.', 'error');
    return;
  }

  if (currentUser.email && typeof auth.login === 'function') {
    const verify = await auth.login(currentUser.email, pass);
    if (verify && verify.success) {
      if (ui) ui.showToast('Password saved and verified. You can now log in manually.', 'success');
    } else if (ui) {
      ui.showToast('Onboarding saved, but password verification failed. Try the Forgot flow.', 'warning');
    }
  }

  window.openDashboardPage();
  if (ui) {
    ui.checkAuthState();
    ui.showToast('🚀 Registration complete! Welcome to VaultSmart!', 'success');
  }
};



window.loginWithGoogleFast = function() {
  const ui = typeof UIRenderer !== 'undefined' ? UIRenderer : window.UIRenderer;
  if (ui) ui.showToast('Use the official Google sign-in button to continue.', 'error');
};

window.loginWithGoogleCustom = function() {
  const ui = typeof UIRenderer !== 'undefined' ? UIRenderer : window.UIRenderer;
  if (ui) ui.showToast('Use the official Google sign-in button to continue.', 'error');
};

window.loginWithPassword = async function(event) {
  if (event && event.preventDefault) event.preventDefault();

  try {
    const emailEl = document.getElementById('loginEmail');
    const passEl = document.getElementById('loginPassword');

    // Clear previous errors first
    if (typeof window.clearInputError === 'function') {
      window.clearInputError('loginEmail', 'loginEmailError');
      window.clearInputError('loginPassword', 'loginPasswordError');
    }

    const email = emailEl ? emailEl.value.trim() : '';
    const pass = passEl ? passEl.value.trim() : '';

    const auth = typeof AuthService !== 'undefined' ? AuthService : window.AuthService;
    const ui = typeof UIRenderer !== 'undefined' ? UIRenderer : window.UIRenderer;
    const storage = typeof StorageService !== 'undefined' ? StorageService : window.StorageService;

    if (!email) {
      if (typeof window.showInputError === 'function') {
        window.showInputError('loginEmail', 'loginEmailError', 'Please enter your Email, Phone Number, or Salvis ID 📧');
      } else if (ui) {
        ui.showToast('Please enter your Email, Phone Number, or Salvis ID 📧', 'warning');
      }
      if (emailEl) emailEl.focus();
      return;
    }

    if (!pass) {
      if (typeof window.showInputError === 'function') {
        window.showInputError('loginPassword', 'loginPasswordError', 'Please enter your Account Password 🔐');
      } else if (ui) {
        ui.showToast('Please enter your Account Password 🔐', 'warning');
      }
      if (passEl) passEl.focus();
      return;
    }

    if (storage && typeof storage.init === 'function') {
      storage.init();
    }

    if (auth) {
      const res = await auth.login(email, pass);
      if (res && res.success) {
        // Clear errors
        if (typeof window.clearInputError === 'function') {
          window.clearInputError('loginEmail', 'loginEmailError');
          window.clearInputError('loginPassword', 'loginPasswordError');
        }

        // Direct Page Redirection via declarative Router
        if (typeof window.Router !== 'undefined' && window.Router.navigate) {
          window.Router.navigate('dashboard');
        } else {
          const authWrapper = document.getElementById('authWrapper');
          const mainWrapper = document.getElementById('mainAppWrapper');
          const profileWrapper = document.getElementById('profileAppWrapper');

          if (authWrapper) {
            authWrapper.style.display = 'none';
            authWrapper.style.setProperty('display', 'none', 'important');
          }
          if (profileWrapper) {
            profileWrapper.style.display = 'none';
            profileWrapper.style.setProperty('display', 'none', 'important');
          }
          if (mainWrapper) {
            mainWrapper.style.display = 'flex';
            mainWrapper.style.setProperty('display', 'flex', 'important');
            mainWrapper.style.visibility = 'visible';
            mainWrapper.style.opacity = '1';
          }
        }

        window.scrollTo({ top: 0, behavior: 'smooth' });

        if (ui) {
          if (typeof ui.checkAuthState === 'function') ui.checkAuthState();
          else if (typeof ui.renderAll === 'function') ui.renderAll();
          ui.showToast(`Welcome back, ${res.user ? res.user.name : 'User'}! 🏦 Vault Unlocked`, 'success');
        }
      } else {
        const errType = res ? res.errorType : 'password';
        const errMsg = res ? res.error : 'Invalid login credentials ❌';

        if (errType === 'email') {
          if (typeof window.showInputError === 'function') {
            window.showInputError('loginEmail', 'loginEmailError', errMsg);
          }
        } else {
          if (typeof window.showInputError === 'function') {
            window.showInputError('loginPassword', 'loginPasswordError', errMsg);
          }
        }

        if (ui) ui.showToast(errMsg, 'error');
      }
    }
  } catch (err) {
    console.error('loginWithPassword error:', err);
    const authWrapper = document.getElementById('authWrapper');
    const mainWrapper = document.getElementById('mainAppWrapper');
    if (authWrapper) authWrapper.style.cssText = 'display: none !important;';
    if (mainWrapper) mainWrapper.style.cssText = 'display: flex !important;';
  }
};

window.logoutUser = function() {
  const auth = typeof AuthService !== 'undefined' ? AuthService : window.AuthService;
  const ui = typeof UIRenderer !== 'undefined' ? UIRenderer : window.UIRenderer;

  if (auth) {
    auth.logout();
  }

  // Restore Login Form & Google Button View
  if (typeof window.showAuthLoginView === 'function') {
    window.showAuthLoginView();
  }

  if (typeof window.Router !== 'undefined' && window.Router.navigate) {
    window.Router.navigate('auth');
  } else {
    const authWrapper = document.getElementById('authWrapper');
    const mainWrapper = document.getElementById('mainAppWrapper');
    const profileWrapper = document.getElementById('profileAppWrapper');
    if (authWrapper) authWrapper.style.cssText = 'display: flex !important;';
    if (mainWrapper) mainWrapper.style.cssText = 'display: none !important;';
    if (profileWrapper) profileWrapper.style.cssText = 'display: none !important;';
  }

  if (ui) {
    ui.checkAuthState();
    ui.showToast('Logged out of Salvis 🚪', 'warning');
  }
};



/* ==========================================================================
   USER PROFILE PAGE NAVIGATION & CONTROLLERS
   ========================================================================== */

window.openProfilePage = function() {
  if (typeof window.Router !== 'undefined' && window.Router.navigate) {
    window.Router.navigate('profile');
    return;
  }

  const authWrapper = document.getElementById('authWrapper');
  const mainWrapper = document.getElementById('mainAppWrapper');
  const profileWrapper = document.getElementById('profileAppWrapper');

  if (authWrapper) authWrapper.style.cssText = 'display: none !important;';
  if (mainWrapper) mainWrapper.style.cssText = 'display: none !important;';
  if (profileWrapper) profileWrapper.style.cssText = 'display: flex !important;';

  window.renderProfileView();
};

window.openDashboardPage = function() {
  if (typeof window.Router !== 'undefined' && window.Router.navigate) {
    window.Router.navigate('dashboard');
    return;
  }

  const authWrapper = document.getElementById('authWrapper');
  const mainWrapper = document.getElementById('mainAppWrapper');
  const profileWrapper = document.getElementById('profileAppWrapper');

  if (authWrapper) authWrapper.style.cssText = 'display: none !important;';
  if (profileWrapper) profileWrapper.style.cssText = 'display: none !important;';
  if (mainWrapper) mainWrapper.style.cssText = 'display: flex !important;';

  const ui = typeof UIRenderer !== 'undefined' ? UIRenderer : window.UIRenderer;
  if (ui) ui.renderAll();
};

window.resolveRegionInfo = function(auth, user) {
  const emptyRegion = {
    country: 'Detected region',
    countryCode: '',
    region: 'Detected',
    currencyCode: '',
    currencySymbol: '',
    locale: 'en-US',
    timeZone: '',
    regionSource: 'auto',
    detectionSource: 'browser',
    detectionConfidence: 'low'
  };
  const detected = auth && typeof auth.detectRegionAndCurrency === 'function'
    ? auth.detectRegionAndCurrency(user && user.locale ? { locale: user.locale } : null)
    : emptyRegion;
  const fallback = { ...emptyRegion, ...detected };

  if (!user || (!user.countryCode && !user.currencyCode)) return fallback;

  const countryCode = String(user.countryCode || '').toUpperCase();
  const explicit = auth && typeof auth.getRegionByCountryCode === 'function' && countryCode
    ? auth.getRegionByCountryCode(countryCode)
    : null;
  const isManual = user.regionSource === 'manual';
  const saved = {
    country: user.country || (explicit && explicit.country) || countryCode || 'Detected region',
    countryCode,
    region: user.region || (explicit && explicit.region) || 'Detected',
    currencyCode: user.currencyCode || (explicit && explicit.currencyCode) || fallback.currencyCode,
    currencySymbol: user.currencySymbol || (explicit && explicit.currencySymbol) || fallback.currencySymbol,
    locale: user.locale || (explicit && explicit.locale) || fallback.locale,
    timeZone: user.timeZone || (explicit && explicit.timeZone) || fallback.timeZone,
    phonePrefix: user.phonePrefix || (explicit && explicit.phonePrefix) || '',
    phonePlaceholder: user.phonePlaceholder || (explicit && explicit.phonePlaceholder) || ''
  };

  return {
    ...(explicit || {}),
    ...saved,
    regionSource: isManual ? 'manual' : 'auto',
    detectionSource: user.detectionSource || (isManual ? 'manual' : 'saved region'),
    detectionConfidence: user.detectionConfidence || (isManual ? 'manual' : 'saved')
  };
};

window.renderProfileView = function() {
  const auth = typeof AuthService !== 'undefined' ? AuthService : window.AuthService;
  const user = auth ? auth.getCurrentUser() : null;

  if (!user) return;

  const nameEl = document.getElementById('profileViewNameDisplay');
  const nicknameEl = document.getElementById('profileViewNicknameDisplay');
  const phoneEl = document.getElementById('profileViewPhoneDisplay');
  const emailEl = document.getElementById('profileViewEmailDisplay');

  if (nameEl) nameEl.textContent = user.name || 'Salvis User';
  if (nicknameEl) nicknameEl.textContent = user.nickname || ('@' + (user.name || 'user').toLowerCase().replace(/[^a-z0-9]/g, ''));
  if (phoneEl) phoneEl.textContent = user.phone || 'Not set';
  if (emailEl) emailEl.textContent = user.email || '';

  const regionInfo = window.resolveRegionInfo(auth, user);
  const regionLabel = `${regionInfo.country} (${regionInfo.currencyCode} ${regionInfo.currencySymbol})`;
  const regionEl = document.getElementById('profileViewRegionDisplay');
  const staticCurrencyEl = document.getElementById('staticCurrencyText');
  const regionSelect = document.getElementById('profileRegionSelect');
  const detectionStatus = document.getElementById('profileRegionDetectionStatus');

  if (document.documentElement && regionInfo.locale) {
    document.documentElement.lang = String(regionInfo.locale).split(/[-_]/)[0];
  }
  if (regionEl) regionEl.textContent = regionLabel;
  if (staticCurrencyEl) staticCurrencyEl.textContent = regionLabel;

  if (regionSelect && auth && typeof auth.getAvailableRegions === 'function') {
    if (regionSelect.dataset.optionsReady !== 'true') {
      const regions = auth.getAvailableRegions();
      regionSelect.innerHTML = regions.map((region) => `<option value="${region.countryCode}">${region.country} (${region.currencyCode} ${region.currencySymbol})</option>`).join('');
      regionSelect.dataset.optionsReady = 'true';
    }
    const hasDetectedOption = Array.from(regionSelect.options || []).some((option) => option.value === regionInfo.countryCode);
    if (!hasDetectedOption) {
      const detectedOption = document.createElement('option');
      detectedOption.value = regionInfo.countryCode || '';
      detectedOption.textContent = regionLabel;
      regionSelect.insertBefore(detectedOption, regionSelect.firstChild);
    }
    regionSelect.value = regionInfo.countryCode || '';
  }

  if (detectionStatus) {
    const sourceLabels = {
      ip: 'IP location',
      'ip-cache': 'cached IP location',
      timezone: 'browser timezone',
      locale: 'browser locale',
      fallback: 'browser settings',
      manual: 'your selection',
      currency: 'currency preference'
    };
    const pending = auth && typeof auth.isRegionDetectionPending === 'function' && auth.isRegionDetectionPending(user.id);
    const status = regionInfo.regionSource === 'manual'
      ? 'Manually selected'
      : pending
        ? 'Refining automatically via IP location...'
        : `Detected automatically via ${sourceLabels[regionInfo.detectionSource] || 'browser settings'}`;
    detectionStatus.textContent = status;
  }

  const avatarEl = document.getElementById('profileImageDisplay');

  if (avatarEl) {
    if (user.avatar && (user.avatar.startsWith('data:image/') || user.avatar.startsWith('http'))) {
      avatarEl.style.backgroundImage = `url('${user.avatar}')`;
      avatarEl.textContent = '';
    } else {
      avatarEl.style.backgroundImage = 'none';
      avatarEl.textContent = user.avatar || '👨‍💼';
    }
  }

  window.renderBankAccountsList();
  window.renderProfilesList();
};

/*    ==========================================================================
   INLINE PROFILE EDITING BAR CONTROLLERS
   ========================================================================== */

window.openInlineProfileEdit = function() {
  const auth = typeof AuthService !== 'undefined' ? AuthService : window.AuthService;
  const user = auth ? auth.getCurrentUser() : null;
  if (!user) return;

  const displayBox = document.getElementById('profileCardDisplayMode');
  const editBarBox = document.getElementById('profileCardEditBarMode');
  const nicknameInput = document.getElementById('inlineEditNicknameInput');
  const legalNameInput = document.getElementById('inlineEditLegalNameInput');
  const phoneInput = document.getElementById('inlineEditPhoneInput');

  if (nicknameInput) nicknameInput.value = user.nickname || ('@' + (user.name || 'user').toLowerCase().replace(/[^a-z0-9]/g, ''));
  if (legalNameInput) legalNameInput.value = user.name || '';
  if (phoneInput) {
    phoneInput.value = user.phone || '';
    const regionInfo = window.resolveRegionInfo(auth, user);
    phoneInput.placeholder = regionInfo.phonePlaceholder || 'Enter your phone number';
  }

  if (displayBox) displayBox.style.display = 'none';
  if (editBarBox) editBarBox.style.display = 'block';
};

window.closeInlineProfileEdit = function() {
  const displayBox = document.getElementById('profileCardDisplayMode');
  const editBarBox = document.getElementById('profileCardEditBarMode');

  if (displayBox) displayBox.style.display = 'block';
  if (editBarBox) editBarBox.style.display = 'none';
};

window.saveInlineProfile = async function() {
  const nicknameInput = document.getElementById('inlineEditNicknameInput');
  const nameInput = document.getElementById('inlineEditLegalNameInput');
  const phoneInput = document.getElementById('inlineEditPhoneInput');
  const nickname = nicknameInput ? nicknameInput.value.trim() : '';
  const name = nameInput ? nameInput.value.trim() : '';
  const phone = phoneInput ? phoneInput.value.trim() : '';

  const auth = typeof AuthService !== 'undefined' ? AuthService : window.AuthService;
  const ui = typeof UIRenderer !== 'undefined' ? UIRenderer : window.UIRenderer;

  if (!auth) return;
  if (!nickname) {
    if (ui) ui.showToast('Please enter a nickname.', 'warning');
    return;
  }
  if (phone && phone.replace(/\D/g, '').length < 7) {
    if (ui) ui.showToast('Please enter a valid phone number.', 'warning');
    return;
  }

  const profileUpdate = { nickname };
  if (name) profileUpdate.name = name;
  if (phone) profileUpdate.phone = phone;

  const updated = await auth.updateUserProfile(profileUpdate);
  if (!updated) {
    if (ui) ui.showToast('Could not save profile changes.', 'error');
    return;
  }

  window.renderProfileView();
  window.closeInlineProfileEdit();
  if (ui) {
    ui.renderHeader();
    ui.showToast('Profile information updated! 💾');
  }
};


window.handleAvatarFileUpload = function(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function(e) {
    const dataUrl = e.target.result;
    const auth = typeof AuthService !== 'undefined' ? AuthService : window.AuthService;
    const ui = typeof UIRenderer !== 'undefined' ? UIRenderer : window.UIRenderer;

    if (!auth) return;
    const updated = await auth.updateUserProfile({ avatar: dataUrl });
    if (!updated) {
      if (ui) ui.showToast('Could not save the profile picture.', 'error');
      return;
    }
    window.renderProfileView();
    if (ui) ui.renderHeader();
    if (ui) ui.showToast('Profile picture updated from media! 📷');
  };
  reader.readAsDataURL(file);
};

window.renderBankAccountsList = function() {
  const container = document.getElementById('bankAccountsContainer');
  if (!container) return;

  const storage = typeof StorageService !== 'undefined' ? StorageService : window.StorageService;
  const banks = storage ? storage.getBankAccounts() : [];

  if (banks.length === 0) {
    container.innerHTML = `
      <div style="color: var(--text-secondary); font-size: 0.85rem; padding: 1rem;">
        No bank accounts linked yet. Click "+ Add Bank Account" above.
      </div>
    `;
    return;
  }

  container.innerHTML = banks.map(b => `
    <div style="background: var(--bg-subtle); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 1rem; position: relative;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.4rem;">
        <span style="font-weight: 700; font-size: 0.95rem; color: var(--brand-navy);">${b.bankName}</span>
        ${b.isPrimary ? '<span class="badge badge-active" style="font-size: 0.65rem;">Primary</span>' : ''}
      </div>
      <div style="font-size: 0.85rem; font-family: monospace; color: var(--brand-blue); margin-bottom: 0.25rem;">
        ${b.accountNumber}
      </div>
      <div style="font-size: 0.75rem; color: var(--text-muted);">
        ${b.accountType} • Routing: ${b.routingNumber}
      </div>
    </div>
  `).join('');
};

window.openAddBankModal = function() {
  const modal = document.getElementById('addBankModal');
  if (modal) modal.classList.add('active');
};

window.saveNewBankAccount = function() {
  const nameEl = document.getElementById('bankNameInput');
  const numEl = document.getElementById('bankAccountNumInput');
  const routingEl = document.getElementById('bankRoutingInput');
  const typeEl = document.getElementById('bankTypeSelect');

  const bankData = {
    bankName: nameEl ? nameEl.value.trim() : '',
    accountNumber: numEl ? numEl.value.trim() : '',
    routingNumber: routingEl ? routingEl.value.trim() : '',
    accountType: typeEl ? typeEl.value : 'Savings Account'
  };

  const storage = typeof StorageService !== 'undefined' ? StorageService : window.StorageService;
  const ui = typeof UIRenderer !== 'undefined' ? UIRenderer : window.UIRenderer;

  if (storage) {
    storage.addBankAccount(bankData);
    window.renderBankAccountsList();
    if (ui) ui.closeModal('addBankModal');
    if (ui) ui.showToast('Bank Account linked successfully! 🏦');
  }
};

window.openEditProfileModal = function() {
  window.openInlineProfileEdit();
};

window.saveEditedProfile = async function() {
  const nameEl = document.getElementById('editNameInput');
  const phoneEl = document.getElementById('editPhoneInput');
  const name = nameEl ? nameEl.value.trim() : '';
  const phone = phoneEl ? phoneEl.value.trim() : '';

  const auth = typeof AuthService !== 'undefined' ? AuthService : window.AuthService;
  const ui = typeof UIRenderer !== 'undefined' ? UIRenderer : window.UIRenderer;

  if (!auth) return;
  if (!name || !phone) {
    if (ui) ui.showToast('Name and phone number are required.', 'warning');
    return;
  }

  const updated = await auth.updateUserProfile({ name, phone });
  if (!updated) {
    if (ui) ui.showToast('Could not save profile changes.', 'error');
    return;
  }

  window.renderProfileView();
  if (ui) {
    ui.renderHeader();
    ui.closeModal('editProfileModal');
    ui.showToast('Profile information updated! 💾');
  }
};

window.renderProfilesList = function() {
  const container = document.getElementById('manageProfilesContainer');
  if (!container) return;

  const storage = typeof StorageService !== 'undefined' ? StorageService : window.StorageService;
  const profiles = storage ? storage.getProfiles() : [];

  container.innerHTML = profiles.map(p => `
    <div onclick="window.switchProfile('${p.id}')" style="background: ${p.isActive ? 'var(--brand-blue)' : 'var(--bg-subtle)'}; color: ${p.isActive ? '#ffffff' : 'var(--text-primary)'}; border: 1px solid var(--border-color); padding: 0.6rem 1rem; border-radius: var(--radius-md); font-size: 0.85rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 0.5rem; transition: all 0.2s ease;">
      <span>${p.type === 'family' ? '👨‍👩‍👧‍👦' : p.type === 'joint' ? '🤝' : '👤'}</span>
      <span>${p.profileName}</span>
      ${p.isActive ? '<span style="font-size: 0.7rem;">✓ Active</span>' : ''}
    </div>
  `).join('');
};

window.openAddProfileModal = function() {
  const modal = document.getElementById('addProfileModal');
  if (modal) modal.classList.add('active');
};

window.saveNewProfile = function() {
  const nameEl = document.getElementById('newProfileNameInput');
  const typeEl = document.getElementById('newProfileTypeSelect');
  const name = nameEl ? nameEl.value.trim() : '';
  const type = typeEl ? typeEl.value : 'personal';

  const storage = typeof StorageService !== 'undefined' ? StorageService : window.StorageService;
  const ui = typeof UIRenderer !== 'undefined' ? UIRenderer : window.UIRenderer;

  if (storage) {
    storage.addProfile(name, type);
    window.renderProfilesList();
    if (ui) ui.closeModal('addProfileModal');
    if (ui) ui.showToast(`Sub-Profile "${name || 'New Profile'}" created! 👥`);
  }
};

window.switchProfile = function(profileId) {
  const storage = typeof StorageService !== 'undefined' ? StorageService : window.StorageService;
  const ui = typeof UIRenderer !== 'undefined' ? UIRenderer : window.UIRenderer;

  if (storage) {
    storage.setActiveProfile(profileId);
    window.renderProfilesList();
    if (ui) ui.showToast('Switched Active Profile 👥');
  }
};

window.cancelPinChange = function() {
  pendingPinChangeToken = '';
  const auth = typeof AuthService !== 'undefined' ? AuthService : window.AuthService;
  if (auth && typeof auth.cancelPinChange === 'function') auth.cancelPinChange();
};

window.openChangePinModal = function() {
  const input = document.getElementById('currentPinInput');
  const ui = typeof UIRenderer !== 'undefined' ? UIRenderer : window.UIRenderer;
  window.cancelPinChange();
  if (input) input.value = '';
  if (ui && typeof ui.openModal === 'function') {
    ui.openModal('verifyCurrentPinModal');
  } else {
    const modal = document.getElementById('verifyCurrentPinModal');
    if (modal) modal.classList.add('active');
  }
};

window.closeInlinePinPanel = function() {};

window.verifyCurrentPin = async function(e) {
  if (e && e.preventDefault) e.preventDefault();

  const auth = typeof AuthService !== 'undefined' ? AuthService : window.AuthService;
  const ui = typeof UIRenderer !== 'undefined' ? UIRenderer : window.UIRenderer;
  const input = document.getElementById('currentPinInput');
  const enteredPin = input ? input.value.trim() : '';

  if (!auth || !auth.isValidPin || !auth.isValidPin(enteredPin)) {
    window.showInputError('currentPinInput', 'currentPinErrorMsg', 'Please enter a valid 4-digit PIN.');
    if (ui) ui.showToast('Please enter your current 4-digit PIN 🔑', 'warning');
    return;
  }

  const res = await auth.verifyPin(enteredPin);
  if (res && res.success) {
    pendingPinChangeToken = auth.beginPinChange(enteredPin) || '';
    if (!pendingPinChangeToken) {
      if (ui) ui.showToast('Could not start the PIN update. Please try again.', 'error');
      return;
    }
    window.clearInputError('currentPinInput', 'currentPinErrorMsg');
    if (input) input.value = '';
    if (ui && typeof ui.closeModal === 'function') {
      ui.closeModal('verifyCurrentPinModal');
    } else {
      const verifyModal = document.getElementById('verifyCurrentPinModal');
      if (verifyModal) verifyModal.classList.remove('active');
    }

    const newPinInput = document.getElementById('newPinInput');
    const confirmPinInput = document.getElementById('confirmPinInput');
    if (newPinInput) newPinInput.value = '';
    if (confirmPinInput) confirmPinInput.value = '';

    if (ui && typeof ui.openModal === 'function') {
      ui.openModal('updateNewPinModal');
    } else {
      const updateModal = document.getElementById('updateNewPinModal');
      if (updateModal) updateModal.classList.add('active');
    }

    setTimeout(() => {
      if (newPinInput) newPinInput.focus();
    }, 100);
    return;
  }

  window.cancelPinChange();
  if (res && res.locked) {
    const message = `Too many attempts. Try again in ${auth ? auth.formatLockout(res.remainingMs) : 30}s 🔒`;
    window.showInputError('currentPinInput', 'currentPinErrorMsg', message);
    if (ui) ui.showToast(message, 'error');
  } else {
    const message = (res && res.error) || 'Incorrect current PIN.';
    window.showInputError('currentPinInput', 'currentPinErrorMsg', message);
    if (ui) ui.showToast('Incorrect current PIN. Please try again.', 'warning');
  }
};

window.submitNewPinUpdate = async function(e) {
  if (e && e.preventDefault) e.preventDefault();

  const auth = typeof AuthService !== 'undefined' ? AuthService : window.AuthService;
  const ui = typeof UIRenderer !== 'undefined' ? UIRenderer : window.UIRenderer;
  const newPinInput = document.getElementById('newPinInput');
  const confirmPinInput = document.getElementById('confirmPinInput');
  const newPin = newPinInput ? newPinInput.value.trim() : '';
  const confirmPin = confirmPinInput ? confirmPinInput.value.trim() : '';

  if (!auth || !auth.isValidPin || !auth.isValidPin(newPin)) {
    if (ui) ui.showToast('New PIN must be a 4-digit number 🔐', 'warning');
    return;
  }
  if (newPin !== confirmPin) {
    if (ui) ui.showToast('New PIN and Confirm PIN do not match! ❌', 'warning');
    return;
  }
  if (!pendingPinChangeToken) {
    if (ui) ui.showToast('Verify your current PIN again before setting a new PIN.', 'warning');
    if (ui && typeof ui.closeModal === 'function') ui.closeModal('updateNewPinModal');
    if (ui && typeof ui.openModal === 'function') ui.openModal('verifyCurrentPinModal');
    return;
  }

  const res = await auth.completePinChange(pendingPinChangeToken, newPin);
  pendingPinChangeToken = '';
  if (res && res.success) {
    window.cancelPinChange();
    if (ui && typeof ui.closeModal === 'function') {
      ui.closeModal('updateNewPinModal');
    } else {
      const updateModal = document.getElementById('updateNewPinModal');
      if (updateModal) updateModal.classList.remove('active');
    }
    if (ui) ui.showToast('Security PIN updated successfully! 🔒', 'success');
    return;
  }

  if (res && res.locked) {
    if (ui) ui.showToast(`Too many attempts. Try again in ${auth.formatLockout(res.remainingMs)}s 🔒`, 'error');
  } else if (ui) {
    ui.showToast((res && res.error) || 'Could not update the Security PIN.', 'error');
  }
};

window.updateUserRegion = async function(countryCode) {
  const auth = typeof AuthService !== 'undefined' ? AuthService : window.AuthService;
  const ui = typeof UIRenderer !== 'undefined' ? UIRenderer : window.UIRenderer;
  const selectedInfo = auth && typeof auth.getRegionByCountryCode === 'function'
    ? auth.getRegionByCountryCode(countryCode)
    : null;

  if (!selectedInfo) {
    window.renderProfileView();
    if (ui) ui.showToast('That region is not available.', 'error');
    return;
  }

  const updated = auth ? await auth.updateUserProfile({
    ...selectedInfo,
    regionSource: 'manual',
    detectionSource: 'manual',
    detectionConfidence: 'manual'
  }) : null;

  if (!updated) {
    window.renderProfileView();
    if (ui) ui.showToast('Could not save the region preference.', 'error');
    return;
  }

  window.renderProfileView();
  if (ui) {
    ui.renderHeader();
    if (ui.renderMetrics) ui.renderMetrics();
    if (ui.renderGoals) ui.renderGoals();
    if (ui.renderChart) ui.renderChart();
    if (ui.renderAnalytics) ui.renderAnalytics();
    ui.showToast(`Region set to ${selectedInfo.country} (${selectedInfo.currencyCode} ${selectedInfo.currencySymbol})`);
  }
};

window.updateUserCurrencyPreference = async function(code) {
  const auth = typeof AuthService !== 'undefined' ? AuthService : window.AuthService;
  if (!auth || typeof auth.getRegionByCurrencyCode !== 'function') return;
  const selectedInfo = auth.getRegionByCurrencyCode(code);
  if (!selectedInfo) return;
  await window.updateUserRegion(selectedInfo.countryCode);
};


/* ==========================================================================
   ENCAPSULATED APPLICATION NAMESPACE
   Aggregates every service under one structured object while retaining the
   legacy window.* aliases used by inline HTML handlers.
   ========================================================================== */

window.Salvis = {
  auth: typeof AuthService !== 'undefined' ? AuthService : window.AuthService,
  storage: typeof StorageService !== 'undefined' ? StorageService : window.StorageService,
  calc: typeof SavingsCalculator !== 'undefined' ? SavingsCalculator : window.SavingsCalculator,
  chart: typeof TrajectoryChart !== 'undefined' ? TrajectoryChart : window.TrajectoryChart,
  notif: typeof NotificationService !== 'undefined' ? NotificationService : window.NotificationService,
  ui: typeof UIRenderer !== 'undefined' ? UIRenderer : window.UIRenderer,
  router: typeof Router !== 'undefined' ? Router : window.Router,
  modals: typeof ModalManager !== 'undefined' ? ModalManager : window.ModalManager
};

function startSalvisApp() {
  window.initAppTheme();

  if (typeof window.ModalManager !== 'undefined' && typeof window.ModalManager.init === 'function') {
    window.ModalManager.init();
  }

  if (typeof window.initGoogleGIS === 'function') {
    window.initGoogleGIS();
  }
  if (typeof window.checkGoogleOAuthCallback === 'function') {
    window.checkGoogleOAuthCallback();
  }

  const storage = typeof StorageService !== 'undefined' ? StorageService : window.StorageService;
  const ui = typeof UIRenderer !== 'undefined' ? UIRenderer : window.UIRenderer;

  if (storage) {
    storage.init();
  }

  if (ui) {
    ui.init();
    window.UIRenderer = ui;
  }
}




if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startSalvisApp);
} else {
  startSalvisApp();
}
