const Product = require('../models/Product');
const Store = require('../models/Store');
require('../models/Category'); // makes sure the model is registered for populate()
const mongoose = require('mongoose');
const slugify = require('slugify');

const getVendorId = (req) => {
  return req.user?._id || req.user?.id || req.userId || req.user;
};

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// ==========================================
// VENDOR: Create Product
// ==========================================
exports.createProduct = async (req, res) => {
  try {
    const vendorId = getVendorId(req);
    if (!vendorId) return res.status(401).json({ error: 'Unauthorized.' });

    const store = await Store.findOne({ vendor: vendorId });
    if (!store) {
      return res.status(400).json({ error: 'You must set up your store profile first.' });
    }

    const { name, description, price, category } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Product name is required.' });
    }
    if (!price || Number.isNaN(Number(price)) || Number(price) < 0) {
      return res.status(400).json({ error: 'A valid price is required.' });
    }
    // Reject instead of saving a product pointing at a category that doesn't exist
    if (!isValidId(category)) {
      return res.status(400).json({ error: 'A valid category is required.' });
    }

    // Parse the stringified dynamic attributes from the frontend
    let parsedAttributes = [];
    if (req.body.attributes) {
      try {
        parsedAttributes = JSON.parse(req.body.attributes).filter(a => a.name && a.value);
      } catch (err) {
        console.error('Failed to parse attributes:', err);
      }
    }

    const baseSlug = slugify(name, { lower: true, strict: true });
    const uniqueSlug = `${baseSlug}-${Math.random().toString(36).substring(2, 8)}`;

    const imagesArray = (req.files?.images || []).map((file, index) => ({
      public_id: file.filename,
      url: file.path,
      isThumbnail: index === 0,
    }));

    const videoFile = req.files?.video?.[0];
    const videoData = videoFile
      ? { public_id: videoFile.filename, url: videoFile.path }
      : undefined;

    const product = await Product.create({
      vendor: vendorId,
      store: store._id,
      name: name.trim(),
      slug: uniqueSlug,
      description: description || '',
      price: Number(price),
      category,
      images: imagesArray,
      video: videoData,
      attributes: parsedAttributes,
      status: 'available',
    });

    res.status(201).json({ status: 'success', data: { product } });
  } catch (error) {
    console.error('Create Product Error:', error);
    res.status(500).json({ error: error.message || 'Server error creating product' });
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

    const formattedProducts = products.map(p => {
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

    const product = await Product.findOneAndDelete({ _id: productId, vendor: vendorId });

    if (!product) {
      return res.status(404).json({ error: 'Product not found or unauthorized' });
    }

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

    const products = await Product.find({
      store: storeId,
      status: { $in: ['available', 'limited'] },
    })
      .populate('category', 'name') // fixes "Uncategorized" on the storefront
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
exports.recordWhatsAppClick = async (req, res) => {
  try {
    await Product.findByIdAndUpdate(req.params.productId, { $inc: { whatsappClicks: 1 } });
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Record click error:', error.message);
    res.status(500).json({ error: 'Failed to record click' });
  }
};