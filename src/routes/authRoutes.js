const express = require('express');
const authController = require('../controllers/authController');
const { protect } = require('../middleware/requireAuth');

const router = express.Router();

// Public Authentication Routes
router.post('/register', authController.registerVendor);
router.post('/login', authController.login);
// Protect these routes with your authentication middleware
router.get('/me', protect, authController.getMe);
router.put('/updatedetails', protect, authController.updateDetails);
router.put('/updatepassword', protect, authController.updatePassword);

// Optional: Protected route to get the current logged-in user's profile data
// router.get('/me', protect, authController.getMe);

module.exports = router;