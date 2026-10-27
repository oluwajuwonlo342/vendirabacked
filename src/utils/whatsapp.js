// WhatsApp links (wa.me) need international digits: 08012345678 -> 2348012345678.
// Returns null when the number can't be valid.
const normalizeWhatsapp = (raw) => {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = `234${digits.slice(1)}`;
  else if (digits.length === 10 && /^[789]/.test(digits)) digits = `234${digits}`;
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
};

module.exports = { normalizeWhatsapp };
