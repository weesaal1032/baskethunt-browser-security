/**
 * Minimal ESM wrapper around jsOTP's TOTP implementation.
 *
 * Source: https://github.com/jiangts/jsotp (MIT License)
 * Adapted for modern browsers using the Web Crypto API and module exports.
 */

const DEFAULT_OPTIONS = {
  digits: 6,
  period: 30,
  algorithm: 'SHA-1',
  window: 1,
};

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function normalizeSecret(secret) {
  if (typeof secret !== 'string') {
    throw new TypeError('Secret must be a base32 string');
  }
  return secret.replace(/=+$/g, '').toUpperCase();
}

function base32ToUint8Array(secret) {
  const normalized = normalizeSecret(secret);
  const bytes = [];
  let bits = 0;
  let value = 0;

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error('Invalid base32 character encountered');
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

async function createHmac(key, counterBuffer, algorithm) {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Web Crypto API is unavailable in this environment');
  }

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, counterBuffer));
}

function dynamicTruncate(hmac) {
  const offset = hmac[hmac.length - 1] & 0x0f;
  return (
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  );
}

export class TOTP {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async generate(secret, timestamp = Date.now()) {
    const secretKey = base32ToUint8Array(secret);
    const counter = Math.floor(timestamp / 1000 / this.options.period);
    const counterBuffer = counterToBuffer(counter);
    const hmac = await createHmac(secretKey, counterBuffer, this.options.algorithm);
    const truncated = dynamicTruncate(hmac);
    const token = truncated % 10 ** this.options.digits;
    return token.toString().padStart(this.options.digits, '0');
  }

  async verify(token, secret, timestamp = Date.now()) {
    if (!new RegExp(`^\\d{${this.options.digits}}$`).test(token)) {
      return false;
    }

    for (let i = -this.options.window; i <= this.options.window; i += 1) {
      const stepTime = timestamp + i * this.options.period * 1000;
      const expected = await this.generate(secret, stepTime);
      if (expected === token) {
        return true;
      }
    }
    return false;
  }
}
