const Store = require('../models/Store');
const slugify = require('slugify');
const cloudinary = require('cloudinary').v2;
const { normalizeWhatsapp, WHATSAPP_HELP } = require('../utils/whatsapp');

const CURRENCIES = ['NGN', 'GHS', 'KES', 'ZAR', 'UGX', 'TZS', 'USD', 'GBP', 'EUR'];
const CTA_MODES = ['order', 'enquire'];

// Stores an admin has suspended or banned never appear publicly
const HIDDEN_STATUSES = ['suspended', 'banned'];

const formatStoreResponse = (store, { publicView = false } = {}) => {
  const storeObj = store.toObject ? store.toObject() : store;
  storeObj.name = storeObj.businessName;
  // The number the WhatsApp link needs, or null if the saved number can't work.
  // Computed on every read, so numbers saved before this change (08012345678) still produce working links.
  storeObj.whatsappDigits = normalizeWhatsapp(storeObj.whatsappNumber);
  if (publicView) delete storeObj.vendor; // customers don't need the owner's account ID
  return storeObj;
};

const getVendorId = (req) => {
  return req.user?._id || req.user?.id || req.userId || req.user;
};

const extractImages = (req) => {
  const out = {};
  const logo = req.files?.logo?.[0];
  const cover = req.files?.coverImage?.[0];
  if (logo) out.logo = { public_id: logo.filename, url: logo.path };
  if (cover) out.coverImage = { public_id: cover.filename, url: cover.path };
  return out;
};

const removeOldImage = async (image) => {
  if (!image?.public_id) return;
  try {
    await cloudinary.uploader.destroy(image.public_id);
  } catch (err) {
    console.error('Cloudinary cleanup failed:', err.message);
  }
};

// Multer uploads to Cloudinary before the controller runs, so when a request is
// rejected afterwards those fresh uploads must be deleted or they become orphans.
const discardUploads = (req) =>
  Promise.all(Object.values(req.files || {}).flat().map((f) => removeOldImage({ public_id: f.filename })));

// Reads the currency and WhatsApp button settings. Only fields that were sent are returned.
const readSettings = (body) => {
  const data = {};

  if (body.currency !== undefined) {
    const currency = String(body.currency).trim().toUpperCase();
    if (!CURRENCIES.includes(currency)) return { error: 'Choose a supported currency.' };
    data.currency = currency;
  }
  if (body.whatsappCta !== undefined) {
    const cta = String(body.whatsappCta).trim();
    if (!CTA_MODES.includes(cta)) return { error: 'Choose "Order" or "Enquire" for the WhatsApp button.' };
    data.whatsappCta = cta;
  }
  return { data };
};

// ==========================================
// VENDOR: Create a store (starts as a private draft)
// ==========================================
exports.createStore = async (req, res) => {
  const fail = async (code, error) => {
    await discardUploads(req);
    return res.status(code).json({ error });
  };

  try {
    const vendorId = getVendorId(req);
    if (!vendorId) return fail(401, 'Unauthorized: Vendor ID not found.');

    const name = String(req.body.name ?? '').trim();
    if (!name) return fail(400, 'Your store needs a name.');

    const whatsappNumber = normalizeWhatsapp(req.body.whatsappNumber);
    if (!whatsappNumber) return fail(400, WHATSAPP_HELP);

    const settings = readSettings(req.body);
    if (settings.error) return fail(400, settings.error);

    const slug = slugify(String(req.body.slug || name), { lower: true, strict: true });
    if (!slug) return fail(400, 'Choose a store URL using letters or numbers.');

    const existingStore = await Store.findOne({ vendor: vendorId });
    if (existingStore) return fail(400, 'You already have a store registered.');

    const store = await Store.create({
      businessName: name,
      slug,
      description: String(req.body.description ?? '').trim().slice(0, 500),
      whatsappNumber,
      vendor: vendorId,
      isPublished: false, // customers can't see it until the vendor publishes from Store Setup
      ...settings.data,
      ...extractImages(req),
    });

    res.status(201).json({ status: 'success', data: { store: formatStoreResponse(store) } });
  } catch (error) {
    console.error('Create Store Error:', error);
    await discardUploads(req);
    if (error.code === 11000) return res.status(400).json({ error: 'This Store URL is already taken.' });
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: Object.values(error.errors)[0].message });
    }
    res.status(500).json({ error: 'Server error creating store' });
  }
};

// ==========================================
// VENDOR: Update own store
// ==========================================
exports.updateMyStore = async (req, res) => {
  let saved = false;
  const fail = async (code, error) => {
    await discardUploads(req);
    return res.status(code).json({ error });
  };

  try {
    const vendorId = getVendorId(req);
    const { name, description, whatsappNumber, slug } = req.body;

    const existing = await Store.findOne({ vendor: vendorId });
    if (!existing) return fail(404, 'Store not found');

    // Only set fields that were actually sent
    const updateData = {};

    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (!trimmed) return fail(400, 'Your store needs a name.');
      updateData.businessName = trimmed;
    }
    if (description !== undefined) {
      updateData.description = String(description).trim().slice(0, 500);
    }
    if (whatsappNumber !== undefined && String(whatsappNumber).trim() !== '') {
      const normalized = normalizeWhatsapp(whatsappNumber);
      if (!normalized) return fail(400, WHATSAPP_HELP);
      updateData.whatsappNumber = normalized;
    }
    if (slug !== undefined && String(slug).trim() !== '') {
      const cleanSlug = slugify(String(slug), { lower: true, strict: true });
      if (!cleanSlug) return fail(400, 'Choose a store URL using letters or numbers.');
      updateData.slug = cleanSlug;
    }

    const settings = readSettings(req.body);
    if (settings.error) return fail(400, settings.error);
    Object.assign(updateData, settings.data);

    const images = extractImages(req);
    Object.assign(updateData, images);

    const store = await Store.findOneAndUpdate(
      { vendor: vendorId },
      { $set: updateData },
      { new: true, runValidators: true }
    );
    saved = true;

    // Clean up replaced images only after the DB update succeeded
    if (images.logo) await removeOldImage(existing.logo);
    if (images.coverImage) await removeOldImage(existing.coverImage);

    res.status(200).json({ status: 'success', data: { store: formatStoreResponse(store) } });
  } catch (error) {
    console.error('Update Store Error:', error);
    if (!saved) await discardUploads(req);
    if (error.code === 11000) return res.status(400).json({ error: 'This Store URL is already taken.' });
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: Object.values(error.errors)[0].message });
    }
    res.status(500).json({ error: 'Server error updating store' });
  }
};

// ==========================================
// VENDOR: Get own store
// ==========================================
exports.getMyStore = async (req, res) => {
  try {
    const store = await Store.findOne({ vendor: getVendorId(req) });
    if (!store) return res.status(404).json({ error: 'Store not found' });
    res.status(200).json({ status: 'success', data: { store: formatStoreResponse(store) } });
  } catch (error) {
    console.error('Get My Store Error:', error);
    res.status(500).json({ error: 'Server error fetching store' });
  }
};

// ==========================================
// PUBLIC: Fetch a store by slug (published stores only)
// ==========================================
exports.getStoreBySlug = async (req, res) => {
  try {
    const store = await Store.findOne({
      slug: String(req.params.storeSlug || '').toLowerCase(),
      isPublished: { $ne: false },      // a missing flag means "live", so existing stores stay up
      status: { $nin: HIDDEN_STATUSES },
    });
    if (!store) return res.status(404).json({ error: 'Store not found' });
    res.status(200).json({ status: 'success', data: { store: formatStoreResponse(store, { publicView: true }) } });
  } catch (error) {
    console.error('Fetch Store By Slug Error:', error);
    res.status(500).json({ error: 'Server error fetching store profile' });
  }
};
