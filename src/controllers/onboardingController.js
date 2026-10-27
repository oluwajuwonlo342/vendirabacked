const crypto = require('crypto');
const mongoose = require('mongoose');
const slugify = require('slugify');
const cloudinary = require('cloudinary').v2;
const Store = require('../models/Store');
const Product = require('../models/Product');
const Category = require('../models/Category');
const User = require('../models/User');
const sendEmail = require('../utils/sendEmail');

const DAY = 24 * 60 * 60 * 1000;
const MAX_REMINDERS = 2;
const REMINDERS_PER_RUN = 50;
const ADMIN_ROLES = ['ADMIN', 'admin'];

class InputError extends Error {}

// ---------- small helpers ----------
const getUserId = (req) => req.user?._id || req.user?.id || req.userId || req.user;
const clean = (value, max) => String(value ?? '').trim().slice(0, max);
const escapeHtml = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clientBase = () => (process.env.CLIENT_URL || '').split(',')[0].trim().replace(/\/$/, '');
const apiBase = () => (process.env.API_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');

const destroy = async (publicId) => {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    console.error('Cloudinary cleanup failed:', err.message);
  }
};
// Multer uploads before the controller runs, so rejected requests must delete their fresh uploads
const discardUploads = (req) =>
  Promise.all(Object.values(req.files || {}).flat().map((f) => destroy(f.filename)));

// WhatsApp links (wa.me) need international digits: 08012345678 -> 2348012345678
const normalizeWhatsapp = (raw) => {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = `234${digits.slice(1)}`;
  else if (digits.length === 10 && /^[789]/.test(digits)) digits = `234${digits}`;
  if (digits.length < 10 || digits.length > 15) {
    throw new InputError('Enter a valid WhatsApp number, for example 08012345678.');
  }
  return digits;
};

const SOCIAL_BASE = {
  instagram: 'https://instagram.com/',
  facebook: 'https://facebook.com/',
  tiktok: 'https://tiktok.com/@',
  twitter: 'https://x.com/',
};
const SOCIAL_LABEL = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', twitter: 'X (Twitter)', website: 'website' };

// Accepts a full link or just a username and always returns a safe https link (or '')
const normalizeSocial = (key, raw) => {
  const value = clean(raw, 200);
  if (!value) return '';
  const bad = () => new InputError(`Enter a valid ${SOCIAL_LABEL[key]} link${key === 'website' ? '' : ' or username'}.`);

  const toUrl = (text) => {
    try {
      const url = new URL(text);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) throw new Error('bad');
      return url.toString();
    } catch {
      throw bad();
    }
  };

  if (/^https?:\/\//i.test(value)) return toUrl(value);
  if (key === 'website') return toUrl(`https://${value}`);
  if (/\//.test(value) || /^www\./i.test(value) || /(instagram|facebook|tiktok|twitter|x)\.com/i.test(value)) {
    return toUrl(`https://${value.replace(/^@/, '')}`);
  }

  const handle = value.replace(/^@/, '');
  if (!/^[\w.\-]{1,60}$/.test(handle)) throw bad();
  return `${SOCIAL_BASE[key]}${handle}`;
};

const uniqueSlug = async (name) => {
  const base = slugify(name, { lower: true, strict: true }) || 'store';
  for (let i = 0; i < 6; i += 1) {
    const candidate = i === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    if (!(await Store.exists({ slug: candidate }))) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
};

// Same slug rule as the Category model's pre-save hook
const toCategorySlug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

const findOrCreateCategory = async (store, vendorId, name) => {
  const slug = toCategorySlug(name) || 'general';
  const existing = await Category.findOne({ store: store._id, slug });
  if (existing) return existing;
  try {
    return await Category.create({ name, store: store._id, user: vendorId });
  } catch (err) {
    if (err.code === 11000) return Category.findOne({ store: store._id, slug });
    throw err;
  }
};

// ---------- checklist (single source of truth for the wizard, Overview card and publish check) ----------
const buildChecklist = (store, productCount) => {
  const s = store ? (store.toObject ? store.toObject() : store) : null;
  const social = s?.socialLinks || {};

  return [
    { key: 'name', step: 1, label: 'Name your store', done: Boolean(s?.businessName), required: true },
    { key: 'whatsapp', step: 1, label: 'Add your WhatsApp number', done: Boolean(s?.whatsappNumber), required: true },
    { key: 'logo', step: 2, label: 'Upload your logo', done: Boolean(s?.logo?.url) },
    { key: 'cover', step: 2, label: 'Add a cover image', done: Boolean(s?.coverImage?.url) },
    { key: 'description', step: 3, label: 'Describe your business', done: Boolean(s?.description?.trim()) },
    { key: 'category', step: 3, label: 'Choose a business category', done: Boolean(s?.businessType) },
    { key: 'location', step: 3, label: 'Add your location', done: Boolean(s?.location?.state && s?.location?.city) },
    { key: 'social', step: 4, label: 'Link your social media', done: Object.values(social).some(Boolean), optional: true },
    { key: 'product', step: 5, label: 'Add your first product', done: productCount > 0, required: true },
    { key: 'publish', step: 6, label: 'Publish your store', done: Boolean(s) && s.isPublished !== false, required: true },
  ];
};

const formatStore = (store) => {
  if (!store) return null;
  const obj = store.toObject();
  obj.name = obj.businessName;
  return obj;
};

const buildState = async (vendorId) => {
  const [owner, store] = await Promise.all([
    User.findById(vendorId).select('name email phone'),
    Store.findOne({ vendor: vendorId }),
  ]);

  const productCount = store ? await Product.countDocuments({ store: store._id }) : 0;
  const products = store
    ? await Product.find({ store: store._id })
        .sort({ createdAt: -1 })
        .limit(4)
        .select('name price images category status')
        .populate('category', 'name')
        .lean()
    : [];

  const checklist = buildChecklist(store, productCount);
  const counted = checklist.filter((i) => !i.optional);
  const done = counted.filter((i) => i.done).length;
  const next = checklist.find((i) => !i.done && !i.optional);

  return {
    owner: { name: owner?.name || '', email: owner?.email || '', phone: owner?.phone || '' },
    store: formatStore(store),
    productCount,
    products,
    checklist,
    progress: { done, total: counted.length, percent: Math.round((done / counted.length) * 100) },
    canPublish: checklist.filter((i) => i.required && i.key !== 'publish').every((i) => i.done),
    isPublished: Boolean(store) && store.isPublished !== false,
    nextStep: next ? next.step : 6,
  };
};

// ==========================================
// VENDOR: current setup state
// ==========================================
exports.getOnboarding = async (req, res) => {
  try {
    res.status(200).json({ status: 'success', data: await buildState(getUserId(req)) });
  } catch (error) {
    console.error('Get Onboarding Error:', error);
    res.status(500).json({ error: 'Server error loading your setup.' });
  }
};

// ==========================================
// VENDOR: save any part of the store (creates a draft on first save)
// ==========================================
exports.saveStore = async (req, res) => {
  let saved = false;
  try {
    const vendorId = getUserId(req);
    const b = req.body || {};

    const existing = await Store.findOne({ vendor: vendorId });
    const isNew = !existing;
    const store = existing || new Store({ vendor: vendorId, isPublished: false });

    if (b.name !== undefined) {
      const name = clean(b.name, 80);
      if (!name) throw new InputError('Your store needs a name.');
      store.businessName = name;
    } else if (isNew) {
      throw new InputError('Give your store a name to get started.');
    }
    if (isNew) store.slug = await uniqueSlug(store.businessName);

    if (b.whatsappNumber !== undefined) {
      store.whatsappNumber = normalizeWhatsapp(b.whatsappNumber);
    } else if (isNew) {
      const owner = await User.findById(vendorId).select('phone');
      store.whatsappNumber = normalizeWhatsapp(owner?.phone);
    }

    if (b.description !== undefined) store.description = clean(b.description, 500);
    if (b.businessType !== undefined) store.businessType = clean(b.businessType, 60);

    for (const key of ['state', 'city', 'address']) {
      if (b[key] !== undefined) store.set(`location.${key}`, clean(b[key], key === 'address' ? 200 : 60));
    }
    for (const key of ['instagram', 'facebook', 'tiktok', 'twitter', 'website']) {
      if (b[key] !== undefined) store.set(`socialLinks.${key}`, normalizeSocial(key, b[key]));
    }

    const oldImages = [];
    const logo = req.files?.logo?.[0];
    const cover = req.files?.coverImage?.[0];
    if (logo) {
      if (store.logo?.public_id) oldImages.push(store.logo.public_id);
      store.logo = { public_id: logo.filename, url: logo.path };
    }
    if (cover) {
      if (store.coverImage?.public_id) oldImages.push(store.coverImage.public_id);
      store.coverImage = { public_id: cover.filename, url: cover.path };
    }

    await store.save();
    saved = true;
    await Promise.all(oldImages.map(destroy)); // only after the save succeeded

    res.status(200).json({ status: 'success', data: await buildState(vendorId) });
  } catch (error) {
    if (!saved) await discardUploads(req);
    if (error instanceof InputError) return res.status(400).json({ error: error.message });
    if (error.code === 11000) return res.status(409).json({ error: 'Something clashed while saving. Please try again.' });
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: Object.values(error.errors)[0].message });
    }
    console.error('Save Store Error:', error);
    res.status(500).json({ error: 'Server error saving your store.' });
  }
};

// ==========================================
// VENDOR: first product (no category set-up needed)
// ==========================================
exports.createFirstProduct = async (req, res) => {
  let saved = false;
  try {
    const vendorId = getUserId(req);
    const store = await Store.findOne({ vendor: vendorId });
    if (!store) throw new InputError('Set up your store basics first.');

    const name = clean(req.body.name, 120);
    const description = clean(req.body.description, 1000);
    const price = Number(req.body.price);
    if (!name) throw new InputError('Give your product a name.');
    if (!Number.isFinite(price) || price <= 0) throw new InputError('Enter a price greater than zero.');
    if (!description) throw new InputError('Add a short description. One line is enough.');

    const categoryName = clean(req.body.category || store.businessType || 'General', 50) || 'General';
    const category = await findOrCreateCategory(store, vendorId, categoryName);

    const images = (req.files?.images || []).map((file, index) => ({
      public_id: file.filename,
      url: file.path,
      isThumbnail: index === 0,
    }));

    const slug = `${slugify(name, { lower: true, strict: true }) || 'product'}-${Math.random().toString(36).slice(2, 8)}`;

    await Product.create({
      vendor: vendorId,
      store: store._id,
      name,
      slug,
      description,
      price,
      category: category._id,
      images,
      status: 'available',
    });
    saved = true;

    res.status(201).json({ status: 'success', data: await buildState(vendorId) });
  } catch (error) {
    if (!saved) await discardUploads(req);
    if (error instanceof InputError) return res.status(400).json({ error: error.message });
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: Object.values(error.errors)[0].message });
    }
    console.error('Create First Product Error:', error);
    res.status(500).json({ error: 'Server error saving your product.' });
  }
};

// ==========================================
// VENDOR: publish / unpublish
// ==========================================
exports.setPublished = async (req, res) => {
  try {
    const vendorId = getUserId(req);
    const wantsLive = !(req.body.publish === false || req.body.publish === 'false');

    const store = await Store.findOne({ vendor: vendorId });
    if (!store) return res.status(404).json({ error: 'Create your store first.' });

    if (wantsLive) {
      const productCount = await Product.countDocuments({ store: store._id });
      const missing = buildChecklist(store, productCount).filter((i) => i.required && i.key !== 'publish' && !i.done);
      if (missing.length) {
        return res.status(400).json({ error: `Before publishing: ${missing.map((i) => i.label.toLowerCase()).join(', ')}.` });
      }
      store.isPublished = true;
      if (!store.publishedAt) store.publishedAt = new Date();
    } else {
      store.isPublished = false;
    }

    await store.save();
    res.status(200).json({ status: 'success', data: await buildState(vendorId) });
  } catch (error) {
    console.error('Set Published Error:', error);
    res.status(500).json({ error: 'Server error updating your store.' });
  }
};

// ==========================================
// REMINDER EMAILS (called once a day by an external scheduler)
// ==========================================
const unsubToken = (userId) =>
  crypto.createHmac('sha256', process.env.JWT_SECRET || '').update(String(userId)).digest('hex');

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

const REMINDER_COPY = {
  'no-store': {
    step: 1,
    subject: 'Your Vendira store is waiting for you',
    headline: 'Set up your store in about 3 minutes',
    body: "You created your Vendira account but haven't set up your store yet. Add your store name and WhatsApp number and we'll guide you through the rest. Your progress is saved as you go.",
    cta: 'Start setting up',
  },
  'no-product': {
    step: 5,
    subject: 'Add your first product to your Vendira store',
    headline: 'Your store is almost ready',
    body: 'Your store details are saved. Add your first product, then publish, and customers can start ordering on WhatsApp.',
    cta: 'Add my first product',
  },
  ready: {
    step: 6,
    subject: 'Your Vendira store is ready to publish',
    headline: 'One click to go live',
    body: 'Your store has everything it needs. Preview it and publish it so customers can find you.',
    cta: 'Preview and publish',
  },
};

exports.sendReminders = async (req, res) => {
  try {
    const secret = process.env.CRON_SECRET || '';
    if (!secret || !safeEqual(req.get('x-cron-secret') || '', secret)) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }
    if (process.env.ONBOARDING_REMINDERS_ENABLED !== 'true') {
      return res.status(200).json({ skipped: true, reason: 'Reminders are switched off.' });
    }

    const now = Date.now();
    const users = await User.find({
      role: { $nin: ADMIN_ROLES },
      email: { $exists: true, $ne: '' },
      remindersOptOut: { $ne: true },
      onboardingReminderCount: { $not: { $gte: MAX_REMINDERS } },
      // Newer than 30 days only, so old accounts are never contacted out of the blue
      createdAt: { $gte: new Date(now - 30 * DAY), $lte: new Date(now - DAY) },
    })
      .select('name email createdAt onboardingReminderCount lastOnboardingReminderAt')
      .sort({ createdAt: 1 })
      .limit(200);

    const isDue = (u) => {
      const count = u.onboardingReminderCount || 0;
      const age = now - u.createdAt.getTime();
      if (count === 0) return age >= DAY; // 1st: a day after signing up
      const since = u.lastOnboardingReminderAt ? now - u.lastOnboardingReminderAt.getTime() : Infinity;
      return age >= 5 * DAY && since >= 3 * DAY; // 2nd: at least 5 days in, 3+ days after the first
    };
    const due = users.filter(isDue);
    const ids = due.map((u) => u._id);

    const [stores, productCounts] = await Promise.all([
      Store.find({ vendor: { $in: ids } }).select('vendor isPublished'),
      Product.aggregate([{ $match: { vendor: { $in: ids } } }, { $group: { _id: '$vendor', n: { $sum: 1 } } }]),
    ]);
    const storeByVendor = new Map(stores.map((s) => [String(s.vendor), s]));
    const productsByVendor = new Map(productCounts.map((p) => [String(p._id), p.n]));

    let sent = 0;
    let failed = 0;
    let skippedLive = 0;

    for (const user of due) {
      if (sent >= REMINDERS_PER_RUN) break;

      const store = storeByVendor.get(String(user._id));
      if (store && store.isPublished !== false) { skippedLive += 1; continue; } // already live: never remind

      const state = !store ? 'no-store' : (productsByVendor.get(String(user._id)) || 0) === 0 ? 'no-product' : 'ready';
      const copy = REMINDER_COPY[state];
      const link = `${clientBase()}/dashboard/setup?step=${copy.step}`;
      const unsubscribe = `${apiBase()}/api/onboarding/unsubscribe?u=${user._id}&t=${unsubToken(user._id)}`;
      const firstName = escapeHtml((user.name || '').split(' ')[0] || 'there');

      try {
        await sendEmail({
          to: user.email,
          subject: copy.subject,
          text: `Hi ${user.name || 'there'},\n\n${copy.body}\n\n${copy.cta}: ${link}\n\nYou can stop these reminders any time: ${unsubscribe}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#111827;line-height:1.55">
              <h2 style="color:#128C7E">${escapeHtml(copy.headline)}</h2>
              <p>Hi ${firstName},</p>
              <p>${escapeHtml(copy.body)}</p>
              <p style="margin:26px 0"><a href="${link}" style="background:#128C7E;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">${escapeHtml(copy.cta)}</a></p>
              <p style="font-size:12px;color:#6b7280">This is a one-off reminder about your unfinished setup. <a href="${unsubscribe}" style="color:#6b7280">Stop these reminders</a>.</p>
            </div>`,
        });
        await User.updateOne({ _id: user._id }, { $inc: { onboardingReminderCount: 1 }, lastOnboardingReminderAt: new Date() });
        sent += 1;
      } catch (err) {
        failed += 1;
        console.error(`Reminder to ${user.email} failed:`, err.message);
      }
    }

    res.status(200).json({ checked: due.length, sent, failed, skippedLive });
  } catch (error) {
    console.error('Send Reminders Error:', error);
    res.status(500).json({ error: 'Server error sending reminders.' });
  }
};

// One-click opt-out from the email link
exports.unsubscribe = async (req, res) => {
  const page = (title, text, code = 200) =>
    res.status(code).send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
      <body style="font-family:Arial,sans-serif;max-width:420px;margin:15vh auto;padding:0 20px;text-align:center;color:#111827">
      <h2 style="color:#128C7E">${title}</h2><p>${text}</p></body>`);

  try {
    const { u, t } = req.query;
    if (!mongoose.Types.ObjectId.isValid(u) || !t || !safeEqual(t, unsubToken(u))) {
      return page('Link not valid', 'This unsubscribe link is not valid or has expired.', 400);
    }
    await User.updateOne({ _id: u }, { remindersOptOut: true });
    return page('You are unsubscribed', "You won't receive setup reminders from Vendira any more.");
  } catch (error) {
    console.error('Unsubscribe Error:', error);
    return page('Something went wrong', 'Please try again later.', 500);
  }
};
