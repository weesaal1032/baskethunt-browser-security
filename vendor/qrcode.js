const CorrectLevel = {
  L: 1,
  M: 0,
  Q: 3,
  H: 2,
};

const VERSION_DATA = {
  1: {
    version: 1,
    size: 21,
    ecCodewordsPerBlock: 10,
    blocks: [{ count: 1, dataCodewords: 16 }],
  },
  2: {
    version: 2,
    size: 25,
    ecCodewordsPerBlock: 16,
    blocks: [{ count: 1, dataCodewords: 28 }],
  },
  3: {
    version: 3,
    size: 29,
    ecCodewordsPerBlock: 26,
    blocks: [{ count: 1, dataCodewords: 44 }],
  },
  4: {
    version: 4,
    size: 33,
    ecCodewordsPerBlock: 18,
    blocks: [{ count: 2, dataCodewords: 32 }],
  },
};

const ALIGNMENT_LOCATIONS = {
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
};

const GF256_EXP = new Uint8Array(512);
const GF256_LOG = new Uint8Array(256);

(function initGaloisField() {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF256_EXP[i] = x;
    GF256_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) {
      x ^= 0x11d;
    }
  }
  for (let i = 255; i < GF256_EXP.length; i += 1) {
    GF256_EXP[i] = GF256_EXP[i - 255];
  }
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) {
    return 0;
  }
  return GF256_EXP[(GF256_LOG[a] + GF256_LOG[b]) % 255];
}

function multiplyPoly(p, q) {
  const result = new Array(p.length + q.length - 1).fill(0);
  for (let i = 0; i < p.length; i += 1) {
    for (let j = 0; j < q.length; j += 1) {
      result[i + j] ^= gfMul(p[i], q[j]);
    }
  }
  return result;
}

const generatorCache = new Map();

function generateGeneratorPolynomial(degree) {
  if (generatorCache.has(degree)) {
    return generatorCache.get(degree);
  }

  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    poly = multiplyPoly(poly, [1, GF256_EXP[i]]);
  }
  generatorCache.set(degree, poly);
  return poly;
}

function calculateErrorCorrection(data, degree) {
  const generator = generateGeneratorPolynomial(degree);
  const buffer = data.concat(new Array(degree).fill(0));

  for (let i = 0; i < data.length; i += 1) {
    const factor = buffer[i];
    if (factor === 0) {
      continue;
    }
    const logFactor = GF256_LOG[factor];
    for (let j = 0; j < generator.length; j += 1) {
      const coeff = generator[j];
      if (coeff !== 0) {
        buffer[i + j] ^= GF256_EXP[(logFactor + GF256_LOG[coeff]) % 255];
      }
    }
  }

  return buffer.slice(buffer.length - degree);
}

function encodeUtf8(text) {
  if (typeof TextEncoder !== 'undefined') {
    return Array.from(new TextEncoder().encode(text));
  }
  const bytes = [];
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6));
      bytes.push(0x80 | (code & 0x3f));
    } else {
      bytes.push(0xe0 | (code >> 12));
      bytes.push(0x80 | ((code >> 6) & 0x3f));
      bytes.push(0x80 | (code & 0x3f));
    }
  }
  return bytes;
}

function chooseVersion(byteLength) {
  for (let version = 1; version <= 4; version += 1) {
    const info = VERSION_DATA[version];
    const dataCapacity = info.blocks.reduce(
      (sum, block) => sum + block.count * block.dataCodewords,
      0
    );
    const totalBitsNeeded = 4 + 8 + byteLength * 8;
    if (totalBitsNeeded <= dataCapacity * 8) {
      return info;
    }
  }
  throw new Error('Input too long for supported QR versions.');
}

function buildDataCodewords(dataBytes, versionInfo) {
  const dataCapacity = versionInfo.blocks.reduce(
    (sum, block) => sum + block.count * block.dataCodewords,
    0
  );

  const bits = [];

  const pushBits = (value, length) => {
    for (let i = length - 1; i >= 0; i -= 1) {
      bits.push((value >> i) & 1);
    }
  };

  pushBits(0b0100, 4);
  pushBits(dataBytes.length, 8);

  for (const byte of dataBytes) {
    pushBits(byte, 8);
  }

  const maxBits = dataCapacity * 8;
  const remainingBits = maxBits - bits.length;
  if (remainingBits < 0) {
    throw new Error('Encoded data exceeds capacity.');
  }

  const terminator = Math.min(4, remainingBits);
  for (let i = 0; i < terminator; i += 1) {
    bits.push(0);
  }

  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) {
      value = (value << 1) | bits[i + j];
    }
    codewords.push(value);
  }

  const padWords = [0xec, 0x11];
  let padIndex = 0;
  while (codewords.length < dataCapacity) {
    codewords.push(padWords[padIndex % padWords.length]);
    padIndex += 1;
  }

  return codewords;
}

function splitIntoBlocks(codewords, versionInfo) {
  const blocks = [];
  let offset = 0;
  for (const blockInfo of versionInfo.blocks) {
    for (let i = 0; i < blockInfo.count; i += 1) {
      const data = codewords.slice(offset, offset + blockInfo.dataCodewords);
      offset += blockInfo.dataCodewords;
      const ec = calculateErrorCorrection(data, versionInfo.ecCodewordsPerBlock);
      blocks.push({ data, ec });
    }
  }
  return blocks;
}

function interleave(blocks) {
  const result = [];
  const maxDataLength = Math.max(...blocks.map((block) => block.data.length));
  for (let i = 0; i < maxDataLength; i += 1) {
    for (const block of blocks) {
      if (i < block.data.length) {
        result.push(block.data[i]);
      }
    }
  }

  const maxEcLength = Math.max(...blocks.map((block) => block.ec.length));
  for (let i = 0; i < maxEcLength; i += 1) {
    for (const block of blocks) {
      if (i < block.ec.length) {
        result.push(block.ec[i]);
      }
    }
  }

  return result;
}

function createEmptyMatrix(size) {
  return Array.from({ length: size }, () => new Array(size).fill(null));
}

function setModule(modules, reserved, row, col, value, isFunction = false) {
  modules[row][col] = value;
  if (isFunction) {
    reserved[row][col] = true;
  }
}

function drawFinderPattern(modules, reserved, row, col) {
  for (let r = -1; r <= 7; r += 1) {
    if (row + r < 0 || row + r >= modules.length) continue;
    for (let c = -1; c <= 7; c += 1) {
      if (col + c < 0 || col + c >= modules.length) continue;
      const isBorder = r === -1 || r === 7 || c === -1 || c === 7;
      const isOuter = r === 0 || r === 6 || c === 0 || c === 6;
      const isInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      const value = !isBorder && (isOuter || isInner);
      setModule(modules, reserved, row + r, col + c, value, true);
    }
  }
}

function drawTimingPatterns(modules, reserved) {
  const size = modules.length;
  for (let i = 8; i < size - 8; i += 1) {
    const value = i % 2 === 0;
    if (modules[6][i] === null) {
      setModule(modules, reserved, 6, i, value, true);
    }
    if (modules[i][6] === null) {
      setModule(modules, reserved, i, 6, value, true);
    }
  }
}

function drawAlignmentPattern(modules, reserved, row, col) {
  for (let r = -2; r <= 2; r += 1) {
    for (let c = -2; c <= 2; c += 1) {
      const value = Math.max(Math.abs(r), Math.abs(c)) !== 1;
      setModule(modules, reserved, row + r, col + c, value, true);
    }
  }
}

function drawAlignmentPatterns(modules, reserved, version) {
  if (version < 2) {
    return;
  }
  const positions = ALIGNMENT_LOCATIONS[version];
  const size = modules.length;
  for (const row of positions) {
    for (const col of positions) {
      if (modules[row][col] !== null) {
        continue;
      }
      if (row < 0 || col < 0 || row >= size || col >= size) {
        continue;
      }
      drawAlignmentPattern(modules, reserved, row, col);
    }
  }
}
function reserveFormatAreas(modules, reserved) {
  const size = modules.length;
  for (let i = 0; i < size; i += 1) {
    if (modules[i][8] === null) {
      setModule(modules, reserved, i, 8, false, true);
    }
    if (modules[8][i] === null) {
      setModule(modules, reserved, 8, i, false, true);
    }
  }
  for (let i = 0; i < 8; i += 1) {
    setModule(modules, reserved, size - 1 - i, 8, false, true);
    setModule(modules, reserved, 8, size - 1 - i, false, true);
  }
  setModule(modules, reserved, 8, size - 8, true, true);
}

function applyDataBits(modules, reserved, dataBits) {
  const size = modules.length;
  let bitIndex = 0;
  let upward = true;

  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) {
      col -= 1;
    }

    for (let rowOffset = 0; rowOffset < size; rowOffset += 1) {
      const row = upward ? size - 1 - rowOffset : rowOffset;
      for (let c = 0; c < 2; c += 1) {
        const currentCol = col - c;
        if (reserved[row][currentCol]) {
          continue;
        }
        const bit = bitIndex < dataBits.length ? dataBits[bitIndex] : 0;
        bitIndex += 1;
        const mask = (row + currentCol) % 2 === 0;
        setModule(modules, reserved, row, currentCol, mask ? !bit : !!bit);
      }
    }
    upward = !upward;
  }
}

function getFormatInfoBits(maskPattern) {
  const ERROR_LEVEL_M = 0b00;
  const value = (ERROR_LEVEL_M << 3) | maskPattern;
  let bits = value << 10;
  const generator = 0b10100110111;

  for (let i = 14; i >= 10; i -= 1) {
    if ((bits >> i) & 1) {
      bits ^= generator << (i - 10);
    }
  }

  const formatBits = ((value << 10) | bits) ^ 0b101010000010010;
  return formatBits & 0xffff;
}

function applyFormatInformation(modules, reserved, formatBits) {
  const size = modules.length;
  const getBit = (index) => ((formatBits >> index) & 1) === 1;

  for (let i = 0; i <= 5; i += 1) {
    setModule(modules, reserved, i, 8, getBit(i), true);
  }
  setModule(modules, reserved, 7, 8, getBit(6), true);
  setModule(modules, reserved, 8, 8, getBit(7), true);
  setModule(modules, reserved, 8, 7, getBit(8), true);
  for (let i = 9; i <= 14; i += 1) {
    setModule(modules, reserved, 8, modules.length - 15 + i, getBit(i), true);
  }

  for (let i = 0; i <= 7; i += 1) {
    const row = size - 1 - i;
    setModule(modules, reserved, row, 8, getBit(i), true);
  }
}

function renderToCanvas(container, modules, options) {
  const size = modules.length;
  const scale = Math.max(1, Math.floor(Math.min(options.width, options.height) / size));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size * scale;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = options.colorLight;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = options.colorDark;

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (modules[row][col]) {
        ctx.fillRect(col * scale, row * scale, scale, scale);
      }
    }
  }

  canvas.style.width = `${options.width}px`;
  canvas.style.height = `${options.height}px`;
  container.innerHTML = '';
  container.appendChild(canvas);
}

function makeModules(interleaved, versionInfo) {
  const modules = createEmptyMatrix(versionInfo.size);
  const reserved = createEmptyMatrix(versionInfo.size).map((row) => row.map(() => false));

  drawFinderPattern(modules, reserved, 0, 0);
  drawFinderPattern(modules, reserved, 0, versionInfo.size - 7);
  drawFinderPattern(modules, reserved, versionInfo.size - 7, 0);
  drawTimingPatterns(modules, reserved);
  drawAlignmentPatterns(modules, reserved, versionInfo.version);
  reserveFormatAreas(modules, reserved);

  const dataBits = [];
  for (const codeword of interleaved) {
    for (let i = 7; i >= 0; i -= 1) {
      dataBits.push((codeword >> i) & 1);
    }
  }

  applyDataBits(modules, reserved, dataBits);
  const formatBits = getFormatInfoBits(0);
  applyFormatInformation(modules, reserved, formatBits);

  return modules;
}

class QRCode {
  constructor(element, options = {}) {
    this._el = typeof element === 'string' ? document.getElementById(element) : element;
    if (!this._el) {
      throw new Error('Container element not found.');
    }

    const defaults = {
      text: '',
      width: 200,
      height: 200,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: CorrectLevel.M,
    };

    this._options = { ...defaults, ...options };
    this.makeCode(this._options.text);
  }

  makeCode(text) {
    if (this._options.correctLevel !== CorrectLevel.M) {
      throw new Error('Only error correction level M is supported in this lightweight build.');
    }

    const bytes = encodeUtf8(text);
    const versionInfo = chooseVersion(bytes.length);
    const dataCodewords = buildDataCodewords(bytes, versionInfo);
    const blocks = splitIntoBlocks(dataCodewords, versionInfo);
    const interleaved = interleave(blocks);
    const modules = makeModules(interleaved, versionInfo);

    renderToCanvas(this._el, modules, this._options);
  }
}

QRCode.CorrectLevel = CorrectLevel;

export { QRCode, CorrectLevel };
