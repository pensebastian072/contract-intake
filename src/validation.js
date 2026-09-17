export function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function normalizeComparable(value) {
  return normalizeWhitespace(value)
    .toLocaleLowerCase('en-US')
    .replace(/[’‘]/g, "'")
    .replace(/\band\b/g, '&')
    .replace(/[^a-z0-9@.$%]/g, '');
}

export function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
}

export function normalizePhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

export function validPhone(value) {
  return normalizePhone(value).length === 10;
}

export function parseDate(value) {
  const match = String(value ?? '').trim().match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/);
  if (!match) return null;
  let [, m, d, y] = match;
  if (y.length === 2) y = String(Number(y) >= 70 ? 1900 + Number(y) : 2000 + Number(y));
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(m) - 1 || date.getDate() !== Number(d)) return null;
  return date;
}

export function formatDate(value) {
  const date = parseDate(value);
  if (!date) return normalizeWhitespace(value);
  return [String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0'), date.getFullYear()].join('/');
}

export function latestDate(values) {
  return values
    .map((value) => ({ value, date: parseDate(value) }))
    .filter(({ date }) => date)
    .sort((a, b) => b.date - a.date)[0]?.value ?? '';
}

export function cleanMoney(value) {
  const match = String(value ?? '').match(/\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/);
  if (!match) return '';
  const amount = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(amount)) return '';
  const decimals = Number.isInteger(amount) ? 0 : 2;
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

export function isLikelyGarbled(text) {
  const value = String(text ?? '');
  if (!value) return false;
  const replacementRatio = (value.match(/�/g) ?? []).length / value.length;
  const symbolRatio = (value.match(/[^\p{L}\p{N}\s.,:;@()$%&'"\/-]/gu) ?? []).length / value.length;
  return replacementRatio > 0.01 || symbolRatio > 0.12;
}

