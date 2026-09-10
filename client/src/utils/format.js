// Format: (1.234.567,89€) for negatives, 1.234.567,89€ for positives
export function formatCurrency(value) {
  if (value === null || value === undefined || isNaN(value)) return '—';
  const num = parseFloat(value);
  const abs = Math.abs(num);
  // Portuguese/EU format: dot thousands, comma decimal
  const formatted = new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs) + '€';
  if (num < 0) return `(${formatted})`;
  return formatted;
}

export function formatCurrencySigned(value) {
  if (value === null || value === undefined || isNaN(value)) return '—';
  const num = parseFloat(value);
  const abs = Math.abs(num);
  const formatted = new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs) + '€';
  if (num < 0) return `(${formatted})`;
  if (num > 0) return `+${formatted}`;
  return formatted;
}

export function formatPercent(value, decimals = 1) {
  if (value === null || value === undefined || isNaN(value) || !isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${parseFloat(value).toFixed(decimals)}%`;
}

export function calcChange(current, previous) {
  const curr = parseFloat(current) || 0;
  const prev = parseFloat(previous) || 0;
  const abs = curr - prev;
  let pct = null;
  if (prev !== 0) {
    pct = ((curr - prev) / Math.abs(prev)) * 100;
  }
  return { abs, pct };
}

// Parse currency input — handles EU format (comma decimal) AND US format (dot decimal)
// Also handles values like "0,843430678785185" → 0.843...
export function parseCurrencyInput(str) {
  if (!str || str === '' || str === '-') return 0;
  let s = String(str).trim();

  // Remove currency symbol and spaces
  s = s.replace(/[€$£\s]/g, '');

  // Handle parentheses for negatives: (1.234,56) → -1234.56
  const isNeg = (s.startsWith('(') && s.endsWith(')')) || s.startsWith('-');
  s = s.replace(/[()−-]/g, '');

  // Detect format:
  // EU format: dots as thousands, comma as decimal → "1.234.567,89"
  // US format: commas as thousands, dot as decimal → "1,234,567.89"
  // Ambiguous single separator: "1,5" or "1.5"

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  const commaIdx = s.lastIndexOf(',');
  const dotIdx = s.lastIndexOf('.');

  let num;

  if (hasComma && hasDot) {
    if (commaIdx > dotIdx) {
      // EU: 1.234.567,89 — comma is decimal
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // US: 1,234,567.89 — dot is decimal
      s = s.replace(/,/g, '');
    }
    num = parseFloat(s);
  } else if (hasComma && !hasDot) {
    // Could be EU decimal: "1,5" or "1.234,567" (thousands)
    const parts = s.split(',');
    const lastPart = parts[parts.length - 1];
    if (parts.length === 2 && lastPart.length <= 2) {
      // Likely decimal: "1,5" → 1.5 or "1234,56" → 1234.56
      s = s.replace(',', '.');
    } else if (parts.length > 2 || (parts.length === 2 && lastPart.length === 3)) {
      // Thousands separator: "1,234,567" or "1,234"
      s = s.replace(/,/g, '');
    } else {
      // Decimal
      s = s.replace(',', '.');
    }
    num = parseFloat(s);
  } else if (hasDot && !hasComma) {
    // Could be US decimal "1.5" or EU thousands "1.234"
    const parts = s.split('.');
    const lastPart = parts[parts.length - 1];
    if (parts.length > 2 || (parts.length === 2 && lastPart.length === 3 && parts[0].length >= 1)) {
      // Likely thousands: "1.234.567" or "1.234"
      // But "1.234" could also be 1.234 decimal — check length
      if (lastPart.length === 3 && parseInt(parts[0]) > 9) {
        s = s.replace(/\./g, ''); // treat as thousands
      }
      // otherwise keep as decimal
    }
    num = parseFloat(s);
  } else {
    num = parseFloat(s);
  }

  if (isNaN(num)) return 0;
  return isNeg ? -Math.abs(num) : Math.abs(num);
}

export function MONTHS_SHORT() {
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
}

export function MONTHS_FULL() {
  return ['January', 'February', 'March', 'April', 'May', 'June',
          'July', 'August', 'September', 'October', 'November', 'December'];
}
