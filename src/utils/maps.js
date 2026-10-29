const ALLOWED_HOSTS = new Set([
  'google.com', 'www.google.com', 'maps.google.com', 'maps.app.goo.gl',
  'goo.gl', 'openstreetmap.org', 'www.openstreetmap.org', 'maps.apple.com',
]);

// Returns '' (empty), a cleaned https link, or null (not a recognised map link)
const normalizeMapLink = (raw) => {
  const text = String(raw ?? '').trim();
  if (!text) return '';

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) return null;
  if ((host === 'google.com' || host === 'www.google.com') && !url.pathname.startsWith('/maps')) return null;
  if (host === 'goo.gl' && !url.pathname.startsWith('/maps')) return null;

  url.protocol = 'https:';
  return url.toString().slice(0, 500);
};

const MAP_LINK_HELP =
  'Paste a link from Google Maps (open your shop, tap Share, then Copy link). Other websites are not accepted.';

module.exports = { normalizeMapLink, MAP_LINK_HELP };
