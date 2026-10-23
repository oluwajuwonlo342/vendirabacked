const express = require('express');
const { 
  getPlatformStats, 
  getAllUsers, 
  deleteUser,
  getAllStores,
  getSettings,       // <-- Add this
  updateSettings// <-- Import the new function
} = require('../controllers/adminController');
const { protect, restrictTo } = require('../middleware/requireAuth');

const router = express.Router();

// Apply your existing admin protection
router.use(protect);
router.use(restrictTo('ADMIN', 'SUPER_ADMIN'));
router.route('/settings')
  .get(getSettings)
  .put(updateSettings);

module.exports = router;

router.route('/stats').get(getPlatformStats);
router.route('/users').get(getAllUsers);
router.route('/users/:id').delete(deleteUser);

// New Store Management Route
router.route('/stores').get(getAllStores);

module.exports = router;