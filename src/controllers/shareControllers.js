const Store = require('../models/Store');
const Product = require('../models/Product');
const mongoose = require('mongoose');
const { parseShortCode } = require('../utils/shortCode');

const HIDDEN_STATUSES = ['suspended', 'banned'];
const LIVE = { isPublished: { $ne: false }, status: { $nin: HIDDEN_STATUSES } };
const CACHE_MS = 60 * 1000; // short, so a new deploy's file names are picked up within a minute

const siteBase = () => (process.env.CLIENT_URL || '').split(',')[0].trim().replace(/\/$/, '');

const escapeHtml = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const clip = (text, max = 200) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

// Cloudinary can resize on the fly. WhatsApp wants a large JPEG-ish image around 1200x630.
const cloudinaryImage = (url, transform) =>
  /^https:\/\/res\.cloudinary\.com\/.+\/image\/upload\//.test(url || '')
    ? url.replace('/image/upload/', `/image/upload/${transform}/`)
    : url || '';

const COVER = 'c_fill,g_auto,w_1200,h_630,q_auto,f_jpg';
const FIT = 'c_pad,b_white,w_1200,h_630,q_auto,f_jpg'; // whole logo or product shown, never cropped

const formatPrice = (amount, currency = 'NGN') => {
  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency,
      minimumFractionDigits: Number.isInteger(Number(amount)) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(Number(amount || 0));
  } catch {
    return `${amount} ${currency}`;
  }
};

// ---------- the site's normal index.html, cached briefly ----------
let cache = { html: '', at: 0 };

const getIndexHtml = async () => {
  if (cache.html && Date.now() - cache.at < CACHE_MS) return cache.html;
  try {
    // The site root always serves index.html and is never rewritten, so this can't loop back here
    const res = await fetch(`${siteBase()}/`, {
      signal: AbortSignal.timeout(8000),
      headers: { 'user-agent': 'vendira-share/1.0' },
    });
    if (!res.ok) throw new Error(`site responded ${res.status}`);
    const html = await res.text();
    if (!/<\/head>/i.test(html)) throw new Error('unexpected page content');
    cache = { html, at: Date.now() };
    return html;
  } catch (err) {
    console.error('Share page: could not load the site page:', err.message);
    if (cache.html) return cache.html; // an older copy is better than nothing
    throw err;
  }
};

const metaTag = (attr, key, value) => `<meta ${attr}="${key}" content="${escapeHtml(value)}">`;

const injectMeta = (html, meta) => {
  const hasImage = Boolean(meta.image);

  // Remove the site's generic tags that we're replacing. Keep its image tags if the store has none.
  const strip = hasImage
    ? /<meta\b[^>]*\b(?:name|property)\s*=\s*["'](?:description|og:[^"']*|twitter:[^"']*)["'][^>]*>\s*/gi
    : /<meta\b[^>]*\b(?:name|property)\s*=\s*["'](?:description|og:(?!image)[^"']*|twitter:(?!image)[^"']*)["'][^>]*>\s*/gi;

  const tags = [
    `<title>${escapeHtml(meta.title)}</title>`,
    metaTag('name', 'description', meta.description),
    metaTag('property', 'og:type', 'website'),
    metaTag('property', 'og:site_name', 'Vendira'),
    metaTag('property', 'og:title', meta.title),
    metaTag('property', 'og:description', meta.description),
    metaTag('property', 'og:url', meta.url),
    metaTag('name', 'twitter:card', hasImage ? 'summary_large_image' : 'summary'),
    metaTag('name', 'twitter:title', meta.title),
    metaTag('name', 'twitter:description', meta.description),
    ...(hasImage
      ? [
          metaTag('property', 'og:image', meta.image),
          metaTag('property', 'og:image:width', '1200'),
          metaTag('property', 'og:image:height', '630'),
          metaTag('name', 'twitter:image', meta.image),
        ]
      : []),
  ].join('\n    ');

  return html
    .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
    .replace(strip, '')
    .replace(/<\/head>/i, () => `    ${tags}\n  </head>`); // a function, so "$" in a price is left alone
};

// Sends the page. Never throws: a failure here must not take the whole site down.
const respond = async (res, meta) => {
  // This response carries the app's own scripts, so the API's strict security headers must not apply
  ['Content-Security-Policy', 'Cross-Origin-Resource-Policy', 'Cross-Origin-Opener-Policy', 'Cross-Origin-Embedder-Policy']
    .forEach((h) => res.removeHeader(h));

  let html;
  try {
    html = await getIndexHtml();
  } catch {
    return res.status(503).type('text/plain').send('Vendira is starting up. Please refresh in a few seconds.');
  }

  res.set('Cache-Control', 'public, max-age=60');
  return res.status(200).type('html').send(meta ? injectMeta(html, meta) : html);
};

// ---------- what the preview says ----------
const buildMeta = (store, path, product) => {
  const name = store.businessName;
  const place = [store.location?.city, store.location?.state].filter(Boolean).join(', ');

  let title = name;
  let description =
    clip(store.description) || `Browse ${name}${place ? ` in ${place}` : ''} and order straight on WhatsApp.`;
  let image = store.coverImage?.url
    ? cloudinaryImage(store.coverImage.url, COVER)
    : store.logo?.url
      ? cloudinaryImage(store.logo.url, FIT)
      : '';
  let url = `${siteBase()}${path}`;

  if (product) {
    title = `${product.name} | ${name}`;
    description = clip(`${formatPrice(product.price, store.currency)}. ${product.description || ''}`);
    if (product.images?.[0]?.url) image = cloudinaryImage(product.images[0].url, FIT);
    url = `${siteBase()}${path}?product=${product._id}`;
  }

  return { title, description, image, url };
};

const findProduct = async (store, productId) => {
  if (!productId || !mongoose.Types.ObjectId.isValid(productId)) return null;
  return Product.findOne({ _id: productId, store: store._id, status: { $in: ['available', 'limited'] } })
    .select('name price description images')
    .lean();
};

const STORE_FIELDS = 'businessName description logo coverImage location currency slug';

// GET /share/store/:slug
exports.shareStore = async (req, res) => {
  try {
    const store = await Store.findOne({ slug: String(req.params.slug || '').toLowerCase(), ...LIVE })
      .select(STORE_FIELDS)
      .lean();
    if (!store) return respond(res, null); // the app shows its own "Store not found"

    const product = await findProduct(store, req.query.product);
    return respond(res, buildMeta(store, `/store/${store.slug}`, product));
  } catch (error) {
    console.error('Share store error:', error.message);
    return respond(res, null);
  }
};

// GET /share/c/:code  (short links, and any other single-word path such as /login)
exports.shareShort = async (req, res) => {
  try {
    const parsed = parseShortCode(req.params.code);
    if (parsed.error) return respond(res, null); // not a short name, so just serve the app

    const store = await Store.findOne({ shortCode: parsed.code, ...LIVE }).select(STORE_FIELDS).lean();
    if (!store) return respond(res, null);

    const product = await findProduct(store, req.query.product);
    return respond(res, buildMeta(store, `/${parsed.code}`, product));
  } catch (error) {
    console.error('Share short error:', error.message);
    return respond(res, null);
  }
};
