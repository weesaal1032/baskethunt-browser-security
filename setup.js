import { TOTP } from './vendor/jsotp.js';
import { QRCode } from './vendor/qrcode.js';

const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
const OTPAUTH_URL = 'otpauth://totp/BrowserLock:User?secret=JBSWY3DPEHPK3PXP&issuer=BrowserLock';

const totp = new TOTP({ digits: 6, period: 30, window: 1 });

const qrWrapper = document.getElementById('qr-wrapper');
const codeInput = document.getElementById('code-input');
const errorMessage = document.getElementById('error-message');
const successMessage = document.getElementById('success-message');
const setupForm = document.getElementById('setup-form');

function renderQrCode() {
  qrWrapper.innerHTML = '';

  try {
    new QRCode(qrWrapper, {
      text: OTPAUTH_URL,
      width: 220,
      height: 220,
      colorDark: '#0f172a',
      colorLight: '#f8fafc',
      correctLevel: QRCode.CorrectLevel.M,
    });
  } catch (error) {
    console.error('Failed to render QR code', error);
    const fallback = document.createElement('span');
    fallback.textContent = 'Unable to render QR code. Reload the page or add the secret manually.';
    qrWrapper.appendChild(fallback);
  }
}

function setFormDisabled(disabled) {
  for (const element of setupForm.elements) {
    element.disabled = disabled;
  }
}

function resetFeedback() {
  errorMessage.textContent = '';
  successMessage.hidden = true;
}

function sanitizeCodeInput(input) {
  const sanitized = input.value.replace(/\D/g, '').slice(0, 6);
  input.value = sanitized;
}

async function completeSetup() {
  await chrome.storage.local.set({ totpSecret: TOTP_SECRET, totpSetupCompletedAt: Date.now() });
  successMessage.hidden = false;

  try {
    await chrome.runtime.sendMessage({ type: 'totp-setup-complete' });
  } catch (error) {
    // Ignore missing listeners during setup.
  }

  setTimeout(() => {
    window.close();
  }, 1500);
}

setupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  resetFeedback();

  const submitButton = setupForm.querySelector('button[type="submit"]');
  const code = codeInput.value.trim();

  if (!/^\d{6}$/.test(code)) {
    errorMessage.textContent = 'Enter the 6-digit code currently shown in your authenticator app.';
    codeInput.focus();
    return;
  }

  setFormDisabled(true);
  submitButton.dataset.originalLabel = submitButton.dataset.originalLabel || submitButton.textContent;
  submitButton.textContent = 'Verifying…';

  try {
    const isValid = await totp.verify(code, TOTP_SECRET);
    if (!isValid) {
      errorMessage.textContent = 'The code did not match. Wait for the next code and try again.';
      setFormDisabled(false);
      submitButton.textContent = submitButton.dataset.originalLabel;
      codeInput.focus();
      codeInput.select();
      return;
    }

    await completeSetup();
  } catch (error) {
    console.error('Failed to verify TOTP code', error);
    errorMessage.textContent = 'Verification failed. Please try again.';
    setFormDisabled(false);
    submitButton.textContent = submitButton.dataset.originalLabel;
    codeInput.focus();
    codeInput.select();
  }
});

codeInput.addEventListener('input', () => sanitizeCodeInput(codeInput));

async function init() {
  renderQrCode();

  try {
    const { totpSecret } = await chrome.storage.local.get('totpSecret');
    if (typeof totpSecret === 'string' && totpSecret.trim()) {
      setupForm.hidden = true;
      successMessage.hidden = false;
      successMessage.textContent = 'Setup is already complete. You can close this tab.';
      setTimeout(() => {
        window.close();
      }, 2000);
      return;
    }
  } catch (error) {
    console.error('Unable to read stored setup state', error);
  }

  codeInput.focus();
}

init().catch((error) => {
  console.error('Failed to initialize setup flow', error);
  errorMessage.textContent = 'Setup cannot start due to an unexpected error.';
  setFormDisabled(true);
});
