const express = require('express');
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const { protect } = require('../middleware/requireAuth');

const router = express.Router();

// ==========================================
// RATE LIMITERS
// ==========================================
const makeLimiter = (limit, error) =>
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error },
  });

// Generous on purpose: many users on mobile networks share one IP address
const authLimiter = makeLimiter(30, 'Too many attempts. Please try again in a few minutes.');
const forgotLimiter = makeLimiter(5, 'Too many requests. Please try again in a few minutes.');
const resetLimiter = makeLimiter(10, 'Too many attempts. Please try again in a few minutes.');

// ==========================================
// PUBLIC ROUTES
// ==========================================
router.post('/register', authLimiter, authController.registerVendor);
router.post('/login', authLimiter, authController.login);
router.post('/forgotpassword', forgotLimiter, authController.forgotPassword);
router.put('/resetpassword/:token', resetLimiter, authController.resetPassword);

// ==========================================
// PROTECTED ROUTES (logged-in users only)
// ==========================================
router.get('/me', protect, authController.getMe);
router.put('/updatedetails', protect, authController.updateDetails);
router.put('/updatepassword', protect, authController.updatePassword);

module.exports = router;
