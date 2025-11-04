import { TOTP } from './vendor/jsotp.js';
import { QRCode } from './vendor/qrcode.js';

const APP_NAME = 'BH-Lock';
const totp = new TOTP({ digits: 6, period: 30, window: 1 });

const secretInput = document.getElementById('secret-input');
const confirmInput = document.getElementById('confirm-input');
const generateButton = document.getElementById('generate-secret');
const qrWrapper = document.getElementById('qr-wrapper');
const codeInput = document.getElementById('code-input');
const errorMessage = document.getElementById('error-message');
const successMessage = document.getElementById('success-message');
const setupForm = document.getElementById('setup-form');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function normalizeSecret(value) {
  return value.replace(/\s+/g, '').toUpperCase();
}

function formatSecret(value) {
  const normalized = normalizeSecret(value);
  return normalized.replace(/(.{4})/g, '$1 ').trim();
}

function sanitizeSecretInput(input) {
  const sanitized = normalizeSecret(input.value).replace(/[^A-Z2-7]/g, '');
  input.value = formatSecret(sanitized);
}

function sanitizeCodeInput(input) {
  const sanitized = input.value.replace(/\D/g, '').slice(0, 6);
  input.value = sanitized;
}

function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

async function generateSecret() {
  const randomBytes = new Uint8Array(10);
  crypto.getRandomValues(randomBytes);
  return base32Encode(randomBytes);
}

function renderQrCode(secret) {
  qrWrapper.innerHTML = '';

  if (!secret) {
    const placeholder = document.createElement('span');
    placeholder.textContent = 'No QR code yet. Enter or generate a secret to preview it.';
    qrWrapper.appendChild(placeholder);
    return;
  }

  const encodedLabel = encodeURIComponent(APP_NAME);
  const otpAuthUrl = `otpauth://totp/${encodedLabel}?secret=${secret}`;

  try {
    new QRCode(qrWrapper, {
      text: otpAuthUrl,
      width: 220,
      height: 220,
      colorDark: '#0f172a',
      colorLight: '#f8fafc',
      correctLevel: QRCode.CorrectLevel.M,
    });
  } catch (error) {
    console.error('Failed to render QR code', error);
    const fallback = document.createElement('span');
    fallback.textContent = 'Unable to render QR code. Use a shorter Base32 secret or try again.';
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

function updateSecretState() {
  resetFeedback();
  sanitizeSecretInput(secretInput);
  sanitizeSecretInput(confirmInput);

  const secret = normalizeSecret(secretInput.value);
  const confirmation = normalizeSecret(confirmInput.value);
  const secretsMatch = secret && confirmation && secret === confirmation;

  if (secretsMatch) {
    renderQrCode(secret);
    codeInput.disabled = false;
  } else {
    codeInput.disabled = true;
    qrWrapper.innerHTML = '';
    const placeholder = document.createElement('span');
    placeholder.textContent = 'Secrets must match before generating a QR code.';
    qrWrapper.appendChild(placeholder);
  }
}

async function handleGenerateClick() {
  const newSecret = await generateSecret();
  const formatted = formatSecret(newSecret);
  secretInput.value = formatted;
  confirmInput.value = formatted;
  updateSecretState();
  codeInput.focus();
}

async function completeSetup(secret) {
  await chrome.storage.local.set({ totpSecret: secret });
  successMessage.hidden = false;

  try {
    await chrome.runtime.sendMessage({ type: 'totp-setup-complete' });
  } catch (error) {
    // Background may not have a listener yet; ignore.
  }

  setTimeout(() => {
    window.close();
  }, 1500);
}

setupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  resetFeedback();

  const submitButton = setupForm.querySelector('button[type="submit"]');
  const secret = normalizeSecret(secretInput.value).replace(/[^A-Z2-7]/g, '');
  const confirmation = normalizeSecret(confirmInput.value).replace(/[^A-Z2-7]/g, '');
  const code = codeInput.value.trim();

  if (!secret || secret.length < 16) {
    errorMessage.textContent = 'Secret must be at least 16 Base32 characters.';
    secretInput.focus();
    return;
  }

  if (secret !== confirmation) {
    errorMessage.textContent = 'Secrets do not match.';
    confirmInput.focus();
    return;
  }

  if (!/^\d{6}$/.test(code)) {
    errorMessage.textContent = 'Enter a valid 6-digit code from your authenticator app.';
    codeInput.focus();
    return;
  }

  setFormDisabled(true);
  submitButton.dataset.originalLabel = submitButton.dataset.originalLabel || submitButton.textContent;
  submitButton.textContent = 'Verifying…';

  try {
    const isValid = await totp.verify(code, secret);
    if (!isValid) {
      errorMessage.textContent = 'The code did not match. Try generating a new code and enter it again.';
      setFormDisabled(false);
      submitButton.textContent = submitButton.dataset.originalLabel;
      codeInput.focus();
      return;
    }

    await completeSetup(secret);
  } catch (error) {
    console.error('Failed to complete setup', error);
    errorMessage.textContent = 'Setup failed. Please try again.';
    setFormDisabled(false);
    submitButton.textContent = submitButton.dataset.originalLabel;
    codeInput.focus();
  }
});

secretInput.addEventListener('input', updateSecretState);
confirmInput.addEventListener('input', updateSecretState);
codeInput.addEventListener('input', () => sanitizeCodeInput(codeInput));
generateButton.addEventListener('click', handleGenerateClick);

async function init() {
  codeInput.disabled = true;

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
    console.error('Unable to load existing setup state', error);
  }

  updateSecretState();
  secretInput.focus();
}

init().catch((error) => {
  console.error('Failed to initialize setup flow', error);
  errorMessage.textContent = 'Setup cannot start due to an unexpected error.';
  setFormDisabled(true);
});
