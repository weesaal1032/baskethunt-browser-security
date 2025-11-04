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
    error.textContent = 'Unable to validate code. Please contact support.';
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
