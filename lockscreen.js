import { TOTP } from './vendor/jsotp.js';

const totp = new TOTP({ digits: 6, period: 30, window: 1 });
let sharedSecret = null;

function normalizeSecret(secret) {
  return secret.replace(/\s+/g, '').toUpperCase();
}

async function loadSharedSecret() {
  try {
    const { totpSecret } = await chrome.storage.local.get('totpSecret');
    if (typeof totpSecret === 'string' && totpSecret.trim()) {
      sharedSecret = normalizeSecret(totpSecret);
    }
  } catch (error) {
    console.error('Failed to load stored TOTP secret', error);
  }
}

async function validateCode(inputValue) {
  if (!sharedSecret) {
    throw new Error('missing_secret');
  }

  try {
    return await totp.verify(inputValue.trim(), sharedSecret);
  } catch (error) {
    console.error('TOTP validation failed', error);
    throw new Error('validation_error');
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  const input = document.getElementById('totp-input');
  const error = document.getElementById('error-message');
  const submitButton = document.querySelector('button[type="submit"]');
  error.textContent = '';

  if (!submitButton.dataset.originalLabel) {
    submitButton.dataset.originalLabel = submitButton.textContent;
  }

  const setSubmitting = (submitting) => {
    input.disabled = submitting;
    submitButton.disabled = submitting;
    submitButton.textContent = submitting
      ? 'Verifying…'
      : submitButton.dataset.originalLabel;
  };

  setSubmitting(true);

  let unlocked = false;

  try {
    const valid = await validateCode(input.value);
    if (valid) {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'lockscreen-unlocked',
        });

        if (response?.success) {
          unlocked = true;
          document.removeEventListener('keydown', trapFocus);
          window.close();
        } else {
          console.error('Unlock rejected by background', response);
          error.textContent = 'Unable to unlock session. Please try again.';
          input.focus();
          return;
        }
      } catch (messageError) {
        console.error('Failed to notify background about unlock', messageError);
        error.textContent = 'Unable to unlock session. Please try again.';
        input.focus();
        return;
      }
    } else {
      error.textContent = 'Invalid code. Please try again.';
      input.select();
      input.focus();
      return;
    }
  } catch (err) {
    if (err.message === 'missing_secret') {
      error.textContent = 'No TOTP secret is configured. Please contact your administrator.';
      input.disabled = true;
      submitButton.disabled = true;
    } else {
      error.textContent = 'Unable to validate code. Please contact support.';
    }
    input.focus();
  } finally {
    if (!unlocked) {
      setSubmitting(false);
    }
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

async function initLockscreen() {
  const form = document.getElementById('lockscreen-form');
  const input = document.getElementById('totp-input');
  form.addEventListener('submit', handleSubmit);
  document.addEventListener('keydown', trapFocus);
  await loadSharedSecret();

  if (!sharedSecret) {
    const error = document.getElementById('error-message');
    error.textContent = 'Setup is incomplete. Please finish TOTP setup to unlock.';
    input.disabled = true;
    const submitButton = document.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    return;
  }

  requestAnimationFrame(() => {
    input.focus();
  });
}

initLockscreen().catch((error) => {
  console.error('Failed to initialize lockscreen', error);
});
