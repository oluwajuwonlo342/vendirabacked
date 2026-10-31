const Product = require('../models/Product');
const Store = require('../models/Store');
const Category = require('../models/Category');
const mongoose = require('mongoose');
const slugify = require('slugify');
const cloudinary = require('cloudinary').v2;
const WhatsAppStat = require('../models/WhatsAppStat');
const MAX_IMAGES = 5;
const STATUSES = ['available', 'limited', 'out_of_stock', 'sold_out', 'hidden'];

const getVendorId = (req) => {
  return req.user?._id || req.user?.id || req.userId || req.user;
};

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// ==========================================
// HELPERS
// ==========================================
const destroyAsset = async (asset, resourceType = 'image') => {
  if (!asset?.public_id) return;
  try {
    await cloudinary.uploader.destroy(asset.public_id, { resource_type: resourceType });
  } catch (err) {
    console.error('Cloudinary cleanup failed:', err.message);
  }
};

// Multer uploads files to Cloudinary before the controller runs, so when a request
// is rejected afterwards, those fresh uploads must be deleted or they become orphans.
const discardUploads = async (req) => {
  await Promise.all([
    ...(req.files?.images || []).map((f) => destroyAsset({ public_id: f.filename })),
    ...(req.files?.video || []).map((f) => destroyAsset({ public_id: f.filename }, 'video')),
  ]);
};

const parseJsonArray = (value) => {
  if (value === undefined || value === '') return [];
  const parsed = JSON.parse(value);
  return Array.isArray(parsed) ? parsed : [];
};

// ==========================================
// VENDOR: Create Product
// ==========================================
exports.createProduct = async (req, res) => {
  const fail = async (code, error) => {
    await discardUploads(req);
    return res.status(code).json({ error });
  };

  try {
    const vendorId = getVendorId(req);
    if (!vendorId) return fail(401, 'Unauthorized.');

    const store = await Store.findOne({ vendor: vendorId });
    if (!store) return fail(400, 'You must set up your store profile first.');

    const { name, description, price, category } = req.body;

    if (!name || !name.trim()) return fail(400, 'Product name is required.');
    if (!description || !description.trim()) return fail(400, 'A description is required.');
    if (!price || Number.isNaN(Number(price)) || Number(price) < 0) {
      return fail(400, 'A valid price is required.');
    }
    if (!isValidId(category)) return fail(400, 'Please select a category.');

    // The category must belong to this vendor's store
    const categoryDoc = await Category.findOne({ _id: category, store: store._id });
    if (!categoryDoc) return fail(400, 'Selected category was not found in your store.');

    let parsedAttributes = [];
    if (req.body.attributes) {
      try {
        parsedAttributes = parseJsonArray(req.body.attributes).filter((a) => a.name && a.value);
      } catch {
        return fail(400, 'Variations were not in the right format.');
      }
    }

    const imagesArray = (req.files?.images || []).map((file, index) => ({
      public_id: file.filename,
      url: file.path,
      isThumbnail: index === 0,
    }));

    const videoFile = req.files?.video?.[0];
    const videoData = videoFile
      ? { public_id: videoFile.filename, url: videoFile.path }
      : undefined;

    const baseSlug = slugify(name, { lower: true, strict: true }) || 'product';
    const uniqueSlug = `${baseSlug}-${Math.random().toString(36).substring(2, 8)}`;

    const product = await Product.create({
      vendor: vendorId,
      store: store._id,
      name: name.trim(),
      slug: uniqueSlug,
      description: description.trim(),
      price: Number(price),
      category: categoryDoc._id,
      images: imagesArray,
      video: videoData,
      attributes: parsedAttributes,
      status: 'available',
    });

    res.status(201).json({ status: 'success', data: { product } });
  } catch (error) {
    console.error('Create Product Error:', error);
    await discardUploads(req);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: Object.values(error.errors)[0].message });
    }
    res.status(500).json({ error: 'Server error creating product.' });
  }
};

// ==========================================
// VENDOR: Update a Product
// ==========================================
exports.updateProduct = async (req, res) => {
  let saved = false;

  const fail = async (code, error) => {
    await discardUploads(req);
    return res.status(code).json({ error });
  };

  try {
    const vendorId = getVendorId(req);
    const { productId } = req.params;

    if (!isValidId(productId)) return fail(400, 'Invalid product ID.');

    const product = await Product.findOne({ _id: productId, vendor: vendorId });
    if (!product) return fail(404, 'Product not found or unauthorized.');

    const { name, description, price, category, status } = req.body;

    if (name !== undefined) {
      if (!name.trim()) return fail(400, 'Product name cannot be empty.');
      product.name = name.trim();
    }
    if (description !== undefined) {
      if (!description.trim()) return fail(400, 'Description cannot be empty.');
      product.description = description.trim();
    }
    if (price !== undefined) {
      const numericPrice = Number(price);
      if (price === '' || Number.isNaN(numericPrice) || numericPrice < 0) {
        return fail(400, 'Enter a valid price.');
      }
      product.price = numericPrice;
    }
    if (status !== undefined) {
      if (!STATUSES.includes(status)) return fail(400, 'Invalid status.');
      product.status = status;
    }
    if (category !== undefined) {
      if (!isValidId(category)) return fail(400, 'Please select a category.');
      const categoryDoc = await Category.findOne({ _id: category, store: product.store });
      if (!categoryDoc) return fail(400, 'Selected category was not found in your store.');
      product.category = categoryDoc._id;
    }

    if (req.body.attributes !== undefined) {
      try {
        product.attributes = parseJsonArray(req.body.attributes).filter((a) => a.name && a.value);
      } catch {
        return fail(400, 'Variations were not in the right format.');
      }
    }

    // Images: drop the ones the vendor removed, append new uploads, enforce the limit
    let removeIds;
    try {
      removeIds = parseJsonArray(req.body.removeImages);
    } catch {
      return fail(400, 'Photo list was not in the right format.');
    }

    const keptImages = product.images.filter((img) => !removeIds.includes(img.public_id));
    const removedImages = product.images.filter((img) => removeIds.includes(img.public_id));
    const newImages = (req.files?.images || []).map((file) => ({
      public_id: file.filename,
      url: file.path,
    }));

    if (keptImages.length + newImages.length > MAX_IMAGES) {
      return fail(400, `A product can have at most ${MAX_IMAGES} photos.`);
    }

    product.images = [
      ...keptImages.map((img) => ({ public_id: img.public_id, url: img.url })),
      ...newImages,
    ].map((img, index) => ({ ...img, isThumbnail: index === 0 }));

    // Video: replace it, remove it, or leave it alone
    const newVideoFile = req.files?.video?.[0];
    const oldVideo = product.video?.url ? { public_id: product.video.public_id } : null;
    let videoToDestroy = null;

    if (newVideoFile) {
      product.video = { public_id: newVideoFile.filename, url: newVideoFile.path };
      videoToDestroy = oldVideo;
    } else if (req.body.removeVideo === 'true' && oldVideo) {
      product.set('video', undefined);
      videoToDestroy = oldVideo;
    }

    await product.save();
    saved = true;

    // Delete replaced media only after the database save succeeded
    await Promise.all([
      ...removedImages.map((img) => destroyAsset(img)),
      videoToDestroy ? destroyAsset(videoToDestroy, 'video') : null,
    ]);

    await product.populate('category', 'name');
    res.status(200).json({ status: 'success', data: { product: product.toObject() } });
  } catch (error) {
    console.error('Update Product Error:', error);
    if (!saved) await discardUploads(req); // once saved, the new files are in use
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: Object.values(error.errors)[0].message });
    }
    res.status(500).json({ error: 'Server error updating product.' });
  }
};

// ==========================================
// VENDOR: Get All Own Products
// ==========================================
exports.getVendorProducts = async (req, res) => {
  try {
    const vendorId = getVendorId(req);

    const products = await Product.find({ vendor: vendorId })
      .populate('category', 'name')
      .sort({ createdAt: -1 });

    const formattedProducts = products.map((p) => {
      const pObj = p.toObject();
      return {
        ...pObj,
        image: pObj.images?.length > 0 ? pObj.images[0].url : '',
      };
    });

    res.status(200).json({ status: 'success', data: { products: formattedProducts } });
  } catch (error) {
    console.error('Get Products Error:', error);
    res.status(500).json({ error: 'Server error fetching products' });
  }
};

// ==========================================
// VENDOR: Delete a Product
// ==========================================
exports.deleteProduct = async (req, res) => {
  try {
    const vendorId = getVendorId(req);
    const { productId } = req.params;

    if (!isValidId(productId)) {
      return res.status(400).json({ error: 'Invalid product ID.' });
    }

    const product = await Product.findOneAndDelete({ _id: productId, vendor: vendorId });

    if (!product) {
      return res.status(404).json({ error: 'Product not found or unauthorized' });
    }

    // Remove the product's media from Cloudinary
    await Promise.all([
      ...product.images.map((img) => destroyAsset(img)),
      product.video?.url ? destroyAsset(product.video, 'video') : null,
    ]);

    res.status(200).json({ status: 'success', message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Delete Product Error:', error);
    res.status(500).json({ error: 'Server error deleting product' });
  }
};

// ==========================================
// PUBLIC: Fetch all products for a store
// ==========================================
exports.getPublicProducts = async (req, res) => {
  try {
    const { storeId } = req.params;
    if (!isValidId(storeId)) {
      return res.status(400).json({ error: 'Invalid store ID' });
    }

    // Draft, suspended and banned stores expose nothing, even if someone has the store ID
    const live = await Store.exists({
      _id: storeId,
      isPublished: { $ne: false },
      status: { $nin: ['suspended', 'banned'] },
    });
    if (!live) return res.status(404).json({ error: 'Store not found' });

    const products = await Product.find({
      store: storeId,
      status: { $in: ['available', 'limited'] },
    })
      .populate('category', 'name')
      .sort({ createdAt: -1 });

    res.status(200).json({ status: 'success', data: { products } });
  } catch (error) {
    console.error('Fetch Public Products Error:', error);
    res.status(500).json({ error: 'Server error fetching store products' });
  }
};

// ==========================================
// PUBLIC: Add Customer Feedback/Review
// ==========================================
exports.addProductFeedback = async (req, res) => {
  try {
    const { productId } = req.params;
    const { customerName, rating, comment } = req.body;

    if (!isValidId(productId)) {
      return res.status(400).json({ error: 'Invalid product ID.' });
    }

    const numericRating = Number(rating);
    if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
    }
    if (!comment || !comment.trim()) {
      return res.status(400).json({ error: 'A comment is required.' });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    product.reviews.push({
      customerName: (customerName || '').trim().slice(0, 60) || 'Anonymous Customer',
      rating: numericRating,
      comment: comment.trim().slice(0, 1000),
    });

    product.totalReviews = product.reviews.length;
    product.averageRating =
      product.reviews.reduce((acc, item) => acc + item.rating, 0) / product.reviews.length;

    await product.save();

    // Return the saved subdocument (includes _id and createdAt)
    const review = product.reviews[product.reviews.length - 1];
    res.status(201).json({ status: 'success', data: { review } });
  } catch (error) {
    console.error('Add Feedback Error:', error);
    res.status(500).json({ error: 'Server error submitting feedback' });
  }
};

// ==========================================
// PUBLIC: Record a Product View
// ==========================================
exports.recordProductView = async (req, res) => {
  try {
    if (!isValidId(req.params.productId)) return res.status(400).json({ error: 'Invalid product ID.' });
    await Product.findByIdAndUpdate(req.params.productId, { $inc: { views: 1 } });
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Record view error:', error.message);
    res.status(500).json({ error: 'Failed to record view' });
  }
};

// ==========================================
// PUBLIC: Record a WhatsApp Click
// ==========================================
// "YYYY-MM-DD" in Nigerian time (UTC+1)
const dayKey = (date = new Date()) => new Date(date.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);

// ==========================================
// PUBLIC: Record a WhatsApp button tap
// This counts taps on the button. It is not an order or a sale.
// ==========================================
exports.recordWhatsAppClick = async (req, res) => {
  try {
    const { productId } = req.params;
    if (!isValidId(productId)) return res.status(400).json({ error: 'Invalid product ID.' });

    const product = await Product.findByIdAndUpdate(
      productId,
      { $inc: { whatsappClicks: 1 } },
      { new: true }
    ).select('store');

    if (product) {
      const filter = { store: product.store, product: product._id, day: dayKey() };
      try {
        await WhatsAppStat.updateOne(filter, { $inc: { clicks: 1 } }, { upsert: true });
      } catch (err) {
        if (err.code !== 11000) throw err;
        await WhatsAppStat.updateOne(filter, { $inc: { clicks: 1 } }); // two taps raced to create the row
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Record click error:', error.message);
    res.status(500).json({ error: 'Failed to record click' });
  }
};
exports.recordWhatsAppClick = async (req, res) => {
  try {
    const { productId } = req.params;
    if (!isValidId(productId)) return res.status(400).json({ error: 'Invalid product ID.' });

    const product = await Product.findByIdAndUpdate(
      productId,
      { $inc: { whatsappClicks: 1 } },
      { new: true }
    ).select('store');

    if (product) {
      const filter = { store: product.store, product: product._id, day: dayKey() };
      try {
        await WhatsAppStat.updateOne(filter, { $inc: { clicks: 1 } }, { upsert: true });
      } catch (err) {
        if (err.code !== 11000) throw err;
        await WhatsAppStat.updateOne(filter, { $inc: { clicks: 1 } }); // two taps raced to create the row
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Record click error:', error.message);
    res.status(500).json({ error: 'Failed to record click' });
  }
};

// ==========================================
// VENDOR: WhatsApp taps over the last 7 and 30 days
// ==========================================
exports.getWhatsAppAnalytics = async (req, res) => {
  try {
    const store = await Store.findOne({ vendor: getVendorId(req) }).select('_id');
    if (!store) {
      return res.status(200).json({ status: 'success', data: { last7Days: 0, last30Days: 0, daily: [] } });
    }

    const dayMs = 24 * 60 * 60 * 1000;
    const since30 = dayKey(new Date(Date.now() - 29 * dayMs));
    const since7 = dayKey(new Date(Date.now() - 6 * dayMs));

    const rows = await WhatsAppStat.aggregate([
      { $match: { store: store._id, day: { $gte: since30 } } },
      { $group: { _id: '$day', clicks: { $sum: '$clicks' } } },
      { $sort: { _id: 1 } },
    ]);

    const daily = rows.map((r) => ({ day: r._id, clicks: r.clicks }));
    const sum = (list) => list.reduce((total, d) => total + d.clicks, 0);

    res.status(200).json({
      status: 'success',
      data: {
        last7Days: sum(daily.filter((d) => d.day >= since7)),
        last30Days: sum(daily),
        daily,
      },
    });
  } catch (error) {
    console.error('WhatsApp analytics error:', error);
    res.status(500).json({ error: 'Server error loading analytics.' });
  }
};


// ==========================================
// VENDOR: Reply to a customer review (or edit your reply)
// ==========================================
exports.replyToReview = async (req, res) => {
  try {
    const vendorId = getVendorId(req);
    const { productId, reviewId } = req.params;

    if (!isValidId(productId) || !isValidId(reviewId)) {
      return res.status(400).json({ error: 'Invalid review.' });
    }

    const message = String(req.body.message ?? '').trim();
    if (!message) return res.status(400).json({ error: 'Write a reply first.' });
    if (message.length > 1000) {
      return res.status(400).json({ error: 'Your reply is too long (maximum 1000 characters).' });
    }

    // Only the product's owner can reply. The positional update touches just this review.
    const product = await Product.findOneAndUpdate(
      { _id: productId, vendor: vendorId, 'reviews._id': reviewId },
      { $set: { 'reviews.$.reply': { message, repliedAt: new Date() } } },
      { new: true }
    );
    if (!product) return res.status(404).json({ error: 'Review not found.' });

    const review = product.reviews.id(reviewId);
    res.status(200).json({ status: 'success', data: { review: review.toObject() } });
  } catch (error) {
    console.error('Reply To Review Error:', error);
    res.status(500).json({ error: 'Server error saving your reply.' });
  }
};

// ==========================================
// VENDOR: Delete your reply
// ==========================================
exports.deleteReviewReply = async (req, res) => {
  try {
    const vendorId = getVendorId(req);
    const { productId, reviewId } = req.params;

    if (!isValidId(productId) || !isValidId(reviewId)) {
      return res.status(400).json({ error: 'Invalid review.' });
    }

    const product = await Product.findOneAndUpdate(
      { _id: productId, vendor: vendorId, 'reviews._id': reviewId },
      { $unset: { 'reviews.$.reply': '' } },
      { new: true }
    );
    if (!product) return res.status(404).json({ error: 'Review not found.' });

    res.status(200).json({ status: 'success', data: { review: product.reviews.id(reviewId).toObject() } });
  } catch (error) {
    console.error('Delete Review Reply Error:', error);
    res.status(500).json({ error: 'Server error deleting your reply.' });
  }
};
