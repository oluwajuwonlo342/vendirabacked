const express = require('express');
const productController = require('../controllers/productController');
const { protect } = require('../middleware/requireAuth');
const upload = require('../middleware/upload');

const router = express.Router();

// ==========================================
// PUBLIC ROUTES (storefront visitors, no login)
// Must stay above router.use(protect)
// ==========================================
router.get('/store/:storeId', productController.getPublicProducts);
router.post('/:productId/view', productController.recordProductView);
router.post('/:productId/click', productController.recordWhatsAppClick);
router.post('/:productId/feedback', productController.addProductFeedback);

// ==========================================
// PROTECTED ROUTES (vendor dashboard only)
// ==========================================
router.use(protect);

router.post(
  '/',
  upload.fields([{ name: 'images', maxCount: 5 }, { name: 'video', maxCount: 1 }]),
  productController.createProduct
);
router.get('/', productController.getVendorProducts);
router.delete('/:productId', productController.deleteProduct);

module.exports = router;