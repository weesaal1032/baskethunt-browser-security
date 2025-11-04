const SHARED_SECRET = 'JBSWY3DPEHPK3PXP';
const TOTP_DIGITS = 6;
const TOTP_STEP_SECONDS = 30;
const WINDOW_STEPS = 1; // allow +/- one time step for slight drift

function base32ToUint8Array(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = secret.replace(/=+$/g, '').toUpperCase();
  const bytes = [];
  let bits = 0;
  let value = 0;

  for (const char of cleaned) {
    const index = alphabet.indexOf(char);
    if (index === -1) {
      throw new Error('Invalid base32 character');
    }
    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return new Uint8Array(bytes);
}

function counterToBuffer(counter) {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setUint32(0, Math.floor(counter / 0x100000000), false);
  view.setUint32(4, counter & 0xffffffff, false);
  return buffer;
}

async function hotp(secretKey, counter) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    secretKey,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, counterToBuffer(counter)));
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, '0');
}

async function generateTotp(secretKey, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 1000 / TOTP_STEP_SECONDS);
  return hotp(secretKey, counter);
}

async function isValidTotp(secretKey, token) {
  if (!/^[0-9]{6}$/.test(token)) {
    return false;
  }

  const now = Date.now();
  for (let i = -WINDOW_STEPS; i <= WINDOW_STEPS; i += 1) {
    const timestamp = now + i * TOTP_STEP_SECONDS * 1000;
    const generated = await generateTotp(secretKey, timestamp);
    if (generated === token) {
      return true;
    }
  }
  return false;
}

async function handleSubmit(event) {
  event.preventDefault();
  const input = document.getElementById('totp-input');
  const error = document.getElementById('error-message');
  try {
    const secretKey = base32ToUint8Array(SHARED_SECRET);
    const valid = await isValidTotp(secretKey, input.value.trim());
    if (valid) {
      const overlay = document.getElementById('lockscreen-overlay');
      overlay.remove();
      document.removeEventListener('keydown', trapFocus);
    } else {
      error.textContent = 'Invalid code. Please try again.';
      input.select();
    }
  } catch (e) {
    console.error('TOTP validation failed', e);
    error.textContent = 'Unable to validate code. Please contact support.';
  }
}

function trapFocus(event) {
  const focusableElements = [document.getElementById('totp-input'), document.querySelector('button[type="submit"]')];
  const first = focusableElements[0];
  const last = focusableElements[focusableElements.length - 1];

  if (event.key !== 'Tab') {
    return;
  }

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function initLockscreen() {
  const form = document.getElementById('lockscreen-form');
  const input = document.getElementById('totp-input');
  form.addEventListener('submit', handleSubmit);
  document.addEventListener('keydown', trapFocus);
  requestAnimationFrame(() => {
    input.focus();
  });
}

initLockscreen();
