const MIN_LENGTH = 3;
const MAX_LENGTH = 24;

// Names that are real pages (or could be mistaken for them) can't be claimed
const RESERVED = new Set([
  'about', 'account', 'admin', 'api', 'app', 'assets', 'auth', 'blog', 'cart', 'checkout', 'contact',
  'dashboard', 'docs', 'faq', 'favicon', 'feedback', 'forgot-password', 'help', 'home', 'index', 'legal',
  'login', 'logout', 'mail', 'manifest', 'null', 'pricing', 'privacy', 'products', 'register', 'reset-password',
  'robots', 'search', 'settings', 'signin', 'signup', 'sitemap', 'static', 'status', 'store', 'stores',
  'support', 'terms', 'tutorial', 'tutorials', 'undefined', 'vendira', 'vendor', 'vendors', 'webmail', 'www',
]);

const FORMAT_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Returns { code } when valid, or { error, reason } when not
const parseShortCode = (raw) => {
  const code = String(raw ?? '').trim().toLowerCase().replace(/^[@/]+/, '');

  if (!code) return { error: 'Enter a short name.', reason: 'empty' };
  if (code.length < MIN_LENGTH || code.length > MAX_LENGTH) {
    return { error: `Use ${MIN_LENGTH} to ${MAX_LENGTH} characters.`, reason: 'invalid' };
  }
  if (!FORMAT_RE.test(code)) {
    return { error: 'Use only letters, numbers and single hyphens, with no spaces.', reason: 'invalid' };
  }
  if (RESERVED.has(code)) {
    return { error: 'That name is reserved. Please choose another.', reason: 'reserved' };
  }
  return { code };
};

module.exports = { parseShortCode, MIN_LENGTH, MAX_LENGTH };