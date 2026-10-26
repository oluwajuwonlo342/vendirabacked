const express = require('express');
const rateLimit = require('express-rate-limit');
const productController = require('../controllers/productController');
const { protect } = require('../middleware/requireAuth');
const upload = require('../middleware/upload');

const router = express.Router();

// ==========================================
// RATE LIMITERS (public routes that anyone can call)
// ==========================================
const makeLimiter = (limit, error) =>
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error },
  });

// Generous on purpose: many mobile users share one IP address
const analyticsLimiter = makeLimiter(300, 'Too many requests. Please slow down.');
const reviewLimiter = makeLimiter(20, 'Too many reviews submitted. Please try again later.');

// ==========================================
// PUBLIC ROUTES (storefront visitors, no login)
// Must stay above router.use(protect)
// ==========================================
router.get('/store/:storeId', productController.getPublicProducts);
router.post('/:productId/view', analyticsLimiter, productController.recordProductView);
router.post('/:productId/click', analyticsLimiter, productController.recordWhatsAppClick);
router.post('/:productId/feedback', reviewLimiter, productController.addProductFeedback);

// ==========================================
// PROTECTED ROUTES (vendor dashboard only)
// ==========================================
router.use(protect);

const productUploads = upload.fields([
  { name: 'images', maxCount: 5 },
  { name: 'video', maxCount: 1 },
]);

router.post('/', productUploads, productController.createProduct);
router.get('/', productController.getVendorProducts);
router.put('/:productId', productUploads, productController.updateProduct);
router.delete('/:productId', productController.deleteProduct);

module.exports = router;
