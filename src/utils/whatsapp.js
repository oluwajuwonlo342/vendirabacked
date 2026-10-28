// Turns what a vendor typed into the digits a WhatsApp link needs, or null if it can't be valid.
//   08012345678    -> 2348012345678   (Nigerian numbers: the leading 0 becomes 234)
//   +233201234567  -> 233201234567    (a leading + means "already international")
//   +234 0801...   -> the stray 0 after 234 is removed
const normalizeWhatsapp = (raw) => {
  const text = String(raw ?? '').trim();
  let digits = text.replace(/\D/g, '');
  if (!digits) return null;

  if (!text.startsWith('+')) {
    if (digits.startsWith('00')) digits = digits.slice(2);
    else if (digits.length === 11 && digits.startsWith('0')) digits = `234${digits.slice(1)}`;
    else if (digits.length === 10 && /^[789]/.test(digits)) digits = `234${digits}`;
  }
  if (digits.startsWith('2340') && digits.length === 14) digits = `234${digits.slice(4)}`;

  if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return null;
  if (digits.startsWith('234') && digits.length !== 13) return null; // Nigerian numbers are 234 + 10 digits
  return digits;
};

const WHATSAPP_HELP =
  'Enter a valid WhatsApp number, for example 08012345678. For numbers outside Nigeria, start with + and the country code, for example +233201234567.';

module.exports = { normalizeWhatsapp, WHATSAPP_HELP };
