const mongoose = require('mongoose');
const Category = require('../models/Category');
const Store = require('../models/Store');
const Product = require('../models/Product');

const getVendorId = (req) => req.user?._id || req.user?.id || req.userId || req.user;

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// Finds the logged-in vendor's store (Store links to its owner via "vendor")
const getMyStore = (req) => Store.findOne({ vendor: getVendorId(req) });

// Loads a category and checks the logged-in vendor owns it
const findOwnedCategory = async (req, res) => {
  if (!isValidId(req.params.id)) {
    res.status(400).json({ success: false, error: 'Invalid category ID' });
    return null;
  }
  const category = await Category.findById(req.params.id);
  if (!category) {
    res.status(404).json({ success: false, error: 'Category not found' });
    return null;
  }
  if (category.user.toString() !== String(getVendorId(req))) {
    res.status(403).json({ success: false, error: 'Not authorized to modify this category' });
    return null;
  }
  return category;
};

// @route   POST /api/categories
exports.createCategory = async (req, res) => {
  try {
    const vendorId = getVendorId(req);
    console.log('[createCategory v2] vendorId:', vendorId);

    const store = await getMyStore(req);
    console.log('[createCategory v2] store found:', !!store);

    if (!store) {
      return res.status(404).json({ success: false, error: 'Store not found (v2). Please create a store first.' });
    }
    // ...rest unchanged

    const name = req.body.name?.trim();
    if (!name) {
      return res.status(400).json({ success: false, error: 'Category name is required.' });
    }

    const category = await Category.create({
      name,
      description: req.body.description?.trim(),
      store: store._id,
      user: getVendorId(req),
    });

    res.status(201).json({ success: true, data: category });
  } catch (error) {
    console.error('Create Category Error:', error);
    if (error.code === 11000) {
      return res.status(400).json({ success: false, error: 'A category with this name already exists in your store.' });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, error: Object.values(error.errors)[0].message });
    }
    res.status(500).json({ success: false, error: 'Server error creating category' });
  }
};

// @route   GET /api/categories
exports.getCategories = async (req, res) => {
  try {
    const store = await getMyStore(req);
    if (!store) {
      return res.status(404).json({ success: false, error: 'Store not found.' });
    }

    const categories = await Category.find({ store: store._id, isActive: true }).sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: categories.length, data: categories });
  } catch (error) {
    console.error('Get Categories Error:', error);
    res.status(500).json({ success: false, error: 'Server error fetching categories' });
  }
};

// @route   PUT /api/categories/:id
exports.updateCategory = async (req, res) => {
  try {
    const category = await findOwnedCategory(req, res);
    if (!category) return;

    // Whitelist: store and user can never be changed from the client
    if (req.body.name !== undefined) category.name = req.body.name.trim();
    if (req.body.description !== undefined) category.description = req.body.description.trim();
    if (req.body.isActive !== undefined) category.isActive = Boolean(req.body.isActive);

    await category.save(); // runs the pre-save hook, so the slug stays in sync with the name

    res.status(200).json({ success: true, data: category });
  } catch (error) {
    console.error('Update Category Error:', error);
    if (error.code === 11000) {
      return res.status(400).json({ success: false, error: 'A category with this name already exists in your store.' });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, error: Object.values(error.errors)[0].message });
    }
    res.status(500).json({ success: false, error: 'Server error updating category' });
  }
};

// @route   DELETE /api/categories/:id
exports.deleteCategory = async (req, res) => {
  try {
    const category = await findOwnedCategory(req, res);
    if (!category) return;

    // Products require a category, so refuse to orphan them
    const productsCount = await Product.countDocuments({ category: category._id });
    if (productsCount > 0) {
      return res.status(400).json({
        success: false,
        error: `This category has ${productsCount} product(s). Move or delete them first.`,
      });
    }

    await category.deleteOne();

    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    console.error('Delete Category Error:', error);
    res.status(500).json({ success: false, error: 'Server error deleting category' });
  }
};