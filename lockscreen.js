import { TOTP } from './vendor/jsotp.js';

const SHARED_SECRET = 'JBSWY3DPEHPK3PXP';
const totp = new TOTP({ digits: 6, period: 30, window: 1 });

async function validateCode(inputValue) {
  try {
    return await totp.verify(inputValue.trim(), SHARED_SECRET);
  } catch (error) {
    console.error('TOTP validation failed', error);
    throw new Error('Validation error');
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  const input = document.getElementById('totp-input');
  const error = document.getElementById('error-message');
  error.textContent = '';

  try {
    const valid = await validateCode(input.value);
    if (valid) {
      const overlay = document.getElementById('lockscreen-overlay');
      overlay.remove();
      document.removeEventListener('keydown', trapFocus);
    } else {
      error.textContent = 'Invalid code. Please try again.';
      input.select();
      input.focus();
    }
  } catch (err) {
    error.textContent = 'Unable to validate code. Please contact support.';
    input.focus();
  }
}

function trapFocus(event) {
  const focusableElements = [
    document.getElementById('totp-input'),
    document.querySelector('button[type="submit"]'),
  ];
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
