const Store = require('../models/Store');
const slugify = require('slugify');
const cloudinary = require('cloudinary').v2;

const formatStoreResponse = (store) => {
  const storeObj = store.toObject ? store.toObject() : store;
  storeObj.name = storeObj.businessName;
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

exports.createStore = async (req, res) => {
  try {
    const { name, description, whatsappNumber } = req.body;
    const vendorId = getVendorId(req);
    
    if (!vendorId) return res.status(401).json({ error: 'Unauthorized: Vendor ID not found.' });
    
    const rawSlug = req.body.slug || name;
    if (!rawSlug || typeof rawSlug !== 'string') {
      return res.status(400).json({ error: 'Store slug must be provided.' });
    }
    
    const slug = slugify(rawSlug, { lower: true, strict: true });
    
    const existingStore = await Store.findOne({ vendor: vendorId });
    if (existingStore) {
      return res.status(400).json({ error: 'You already have a store registered.' });
    }
    
    const store = await Store.create({
      businessName: name,
      slug,
      description,
      whatsappNumber,
      vendor: vendorId, // Matches your Schema exactly
      ...extractImages(req),
    });
    
    res.status(201).json({ status: 'success', data: { store: formatStoreResponse(store) } });
  } catch (error) {
    console.error('Create Store Error:', error);
    if (error.code === 11000) return res.status(400).json({ error: 'This Store URL is already taken.' });
    res.status(500).json({ error: 'Server error creating store' });
  }
};

exports.updateMyStore = async (req, res) => {
  try {
    const vendorId = getVendorId(req);
    const { name, description, whatsappNumber, slug } = req.body;
    
    const existing = await Store.findOne({ vendor: vendorId });
    if (!existing) return res.status(404).json({ error: 'Store not found' });
    
    const updateData = {};
    if (name) updateData.businessName = name;
    if (description !== undefined) updateData.description = description;
    if (whatsappNumber) updateData.whatsappNumber = whatsappNumber;
    if (slug && typeof slug === 'string') {
      updateData.slug = slugify(slug, { lower: true, strict: true });
    }
    
    const images = extractImages(req);
    Object.assign(updateData, images);
    
    const store = await Store.findOneAndUpdate(
      { vendor: vendorId },
      { $set: updateData },
      { new: true, runValidators: true }
    );
    
    if (images.logo) await removeOldImage(existing.logo);
    if (images.coverImage) await removeOldImage(existing.coverImage);
    
    res.status(200).json({ status: 'success', data: { store: formatStoreResponse(store) } });
  } catch (error) {
    console.error('Update Store Error:', error);
    if (error.code === 11000) return res.status(400).json({ error: 'This Store URL is already taken.' });
    res.status(500).json({ error: 'Server error updating store' });
  }
};

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

exports.getStoreBySlug = async (req, res) => {
  try {
    const store = await Store.findOne({ slug: req.params.storeSlug });
    if (!store) return res.status(404).json({ error: 'Store not found' });
    res.status(200).json({ status: 'success', data: { store: formatStoreResponse(store) } });
  } catch (error) {
    console.error('Fetch Store By Slug Error:', error);
    res.status(500).json({ error: 'Server error fetching store profile' });
  }
};