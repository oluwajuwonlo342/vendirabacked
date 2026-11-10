const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const User = require('../models/User');
const Store = require('../models/Store');
const Product = require('../models/Product');
const Category = require('../models/Category');
const PlatformSettings = require('../models/PlatformSettings');

// Roles are stored in capitals ('ADMIN'), so compare in both cases
const ADMIN_ROLES = ['ADMIN', 'admin', 'SUPER_ADMIN', 'super_admin'];
const isAdminRole = (role) => ADMIN_ROLES.includes(String(role));
const NOT_ADMIN = { role: { $nin: ADMIN_ROLES } };
const HIDDEN_STATUSES = ['suspended', 'banned'];

const getAdminId = (req) => req.user?._id || req.user?.id || req.userId || req.user;

const destroyAsset = async (asset, resourceType = 'image') => {
  if (!asset?.public_id) return;
  try {
    await cloudinary.uploader.destroy(asset.public_id, { resource_type: resourceType });
  } catch (err) {
    console.error('Cloudinary cleanup failed:', err.message);
  }
};

// @desc    Get global platform statistics
// @route   GET /api/admin/stats
// @access  Private/Admin
exports.getPlatformStats = async (req, res) => {
  try {
    // Run all database counts simultaneously for faster response
    const [totalUsers, totalStores, publishedStores, draftStores, totalProducts, viewsAgg] = await Promise.all([
      User.countDocuments(NOT_ADMIN), // vendors only, not admins
      Store.countDocuments(),
      Store.countDocuments({ isPublished: { $ne: false }, status: { $nin: HIDDEN_STATUSES } }),
      Store.countDocuments({ isPublished: false }),
      Product.countDocuments(),
      // Stores don't record views. Visitors view products, so add those up.
      Product.aggregate([{ $group: { _id: null, views: { $sum: '$views' } } }]),
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalUsers,
        totalStores,
        publishedStores,
        draftStores,
        totalProducts,
        totalPlatformViews: viewsAgg[0]?.views || 0,
      },
    });
  } catch (error) {
    console.error('Platform Stats Error:', error);
    res.status(500).json({ success: false, error: 'Server error loading platform statistics.' });
  }
};

// @desc    Get all registered users/vendors
// @route   GET /api/admin/users
// @access  Private/Admin
exports.getAllUsers = async (req, res) => {
  try {
    // Everyone except SUPER_ADMINs, newest first, without any password or reset-token fields
    const users = await User.find({ role: { $nin: ['SUPER_ADMIN', 'super_admin'] } })
      .select('-password -resetPasswordToken -resetPasswordExpires')
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({ success: true, count: users.length, data: users });
  } catch (error) {
    console.error('Get Users Error:', error);
    res.status(500).json({ success: false, error: 'Server error fetching users.' });
  }
};

// @desc    Delete a user and their associated data
// @route   DELETE /api/admin/users/:id
// @access  Private/Admin
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid user ID.' });
    }
    if (String(id) === String(getAdminId(req))) {
      return res.status(400).json({ success: false, error: 'You cannot delete your own account.' });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    // Protection check to prevent admins from deleting other admins
    if (isAdminRole(user.role)) {
      return res.status(403).json({ success: false, error: 'Cannot delete another administrator.' });
    }

    // Collect what belongs to this vendor before anything is removed
    const stores = await Store.find({ vendor: user._id }).select('_id logo coverImage').lean();
    const storeIds = stores.map((s) => s._id);
    const products = await Product.find({
      $or: [{ vendor: user._id }, { store: { $in: storeIds } }],
    })
      .select('images video')
      .lean();

    // Optional models are looked up at run time, so this works whether or not they exist yet
    const WhatsAppStat = mongoose.models.WhatsAppStat;
    const EmailSend = mongoose.models.EmailSend;

    await Promise.all([
      Product.deleteMany({ _id: { $in: products.map((p) => p._id) } }),
      Category.deleteMany({ $or: [{ user: user._id }, { store: { $in: storeIds } }] }),
      Store.deleteMany({ _id: { $in: storeIds } }),
      WhatsAppStat ? WhatsAppStat.deleteMany({ store: { $in: storeIds } }) : null,
      EmailSend ? EmailSend.deleteMany({ user: user._id }) : null,
    ]);
    await user.deleteOne();

    // Photos and videos last, and best effort: a Cloudinary hiccup must not undo the deletion
    await Promise.all([
      ...stores.flatMap((s) => [destroyAsset(s.logo), destroyAsset(s.coverImage)]),
      ...products.flatMap((p) => [
        ...(p.images || []).map((img) => destroyAsset(img)),
        p.video?.url ? destroyAsset(p.video, 'video') : null,
      ]),
    ]);

    res.status(200).json({ success: true, data: {} });
  } catch (error) {
    console.error('Delete User Error:', error);
    res.status(500).json({ success: false, error: 'Server error deleting the user.' });
  }
};

// @desc    Get all platform stores
// @route   GET /api/admin/stores
// @access  Private/Admin
exports.getAllStores = async (req, res) => {
  try {
    const [stores, totals] = await Promise.all([
      Store.find()
        .populate('vendor', 'name email')
        .sort({ createdAt: -1 })
        .lean(),
      // One query gives every store's product count and total product views
      Product.aggregate([
        { $group: { _id: '$store', count: { $sum: 1 }, views: { $sum: '$views' } } },
      ]),
    ]);

    const totalsByStore = Object.fromEntries(totals.map((t) => [String(t._id), t]));
    stores.forEach((s) => {
      const t = totalsByStore[String(s._id)];
      s.productCount = t?.count || 0; // 0 for stores with no products
      s.viewCount = t?.views || 0;
    });

    res.status(200).json({ success: true, count: stores.length, data: stores });
  } catch (error) {
    console.error('Admin Get Stores Error:', error);
    res.status(500).json({ success: false, error: 'Server error fetching stores.' });
  }
};
// @desc    Get platform settings
// @route   GET /api/admin/settings
// @access  Private/Admin
exports.getSettings = async (req, res) => {
  try {
    let settings = await PlatformSettings.findOne();

    // Auto-initialize default settings on first load if collection is empty
    if (!settings) {
      settings = await PlatformSettings.create({});
    }

    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    console.error('Get Settings Error:', error);
    res.status(500).json({ success: false, error: 'Server error loading settings.' });
  }
};

// @desc    Update platform settings
// @route   PUT /api/admin/settings
// @access  Private/Admin
exports.updateSettings = async (req, res) => {
  try {
    // Never let a request overwrite the document's own bookkeeping fields or inject operators
    const updates = {};
    Object.entries(req.body || {}).forEach(([key, value]) => {
      if (['_id', '__v', 'createdAt', 'updatedAt'].includes(key) || key.startsWith('$')) return;
      updates[key] = value;
    });

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'Nothing to update.' });
    }

    const settings = await PlatformSettings.findOneAndUpdate(
      {}, // Empty query matches the single document
      { $set: updates },
      { new: true, runValidators: true, upsert: true } // Upsert ensures creation if missing
    );

    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    console.error('Update Settings Error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, error: Object.values(error.errors)[0].message });
    }
    res.status(500).json({ success: false, error: 'Server error saving settings.' });
  }
};
