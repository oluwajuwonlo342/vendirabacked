const User = require('../models/User');
const Store = require('../models/Store');
const Product = require('../models/Product');
const PlatformSettings = require('../models/PlatformSettings');

// @desc    Get global platform statistics
// @route   GET /api/admin/stats
// @access  Private/Admin
exports.getPlatformStats = async (req, res) => {
  try {
    // Run all database counts simultaneously for faster response
    const [totalUsers, totalStores, totalProducts, stores] = await Promise.all([
      User.countDocuments({ role: { $ne: 'admin' } }), // Count only vendors/customers
      Store.countDocuments(),
      Product.countDocuments(),
      Store.find({}, 'views') // Fetch only the views field from all stores
    ]);

    // Aggregate total views across all stores
    const totalPlatformViews = stores.reduce((acc, store) => acc + (store.views || 0), 0);

    res.status(200).json({
      success: true,
      data: {
        totalUsers,
        totalStores,
        totalProducts,
        totalPlatformViews
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
// @desc    Get all registered users/vendors
// @route   GET /api/admin/users
// @access  Private/Admin
exports.getAllUsers = async (req, res) => {
  try {
    // Fetch all users except SUPER_ADMINs, sorted by newest first
    const users = await User.find({ role: { $ne: 'SUPER_ADMIN' } }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: users.length, data: users });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Delete a user and their associated data
// @route   DELETE /api/admin/users/:id
// @access  Private/Admin
exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    // Protection check to prevent admins from deleting other admins
    if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, error: 'Cannot delete another administrator.' });
    }

    // Delete the user (Mongoose pre-remove hooks should ideally handle cascading deletes for stores/products)
    await user.deleteOne();

    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Get all platform stores
// @route   GET /api/admin/stores
// @access  Private/Admin
exports.getAllStores = async (req, res) => {
  try {
    // Fetch stores and populate the vendor's name and email
    const stores = await Store.find()
     .populate('vendor', 'name email')
      .sort({ createdAt: -1 });
      
    res.status(200).json({ success: true, count: stores.length, data: stores });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getSettings = async (req, res) => {
  try {
    let settings = await PlatformSettings.findOne();
    
    // Auto-initialize default settings on first load if collection is empty
    if (!settings) {
      settings = await PlatformSettings.create({}); 
    }
    
    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// @desc    Update platform settings
// @route   PUT /api/admin/settings
// @access  Private/Admin
exports.updateSettings = async (req, res) => {
  try {
    const settings = await PlatformSettings.findOneAndUpdate(
      {}, // Empty query matches the single document
      { $set: req.body },
      { new: true, runValidators: true, upsert: true } // Upsert ensures creation if missing
    );
    
    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};