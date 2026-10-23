const express = require('express');
const storeController = require('../controllers/storeController');
const { protect } = require('../middleware/requireAuth');
const upload = require('../middleware/upload'); // Ensure path matches your upload middleware

const router = express.Router();

// ==========================================
// PUBLIC ROUTES (Storefront)
// ==========================================
router.get('/slug/:storeSlug', storeController.getStoreBySlug);

// ==========================================
// PROTECTED ROUTES (Vendor Dashboard Only)
// ==========================================
router.use(protect);

router.get('/my-store', storeController.getMyStore);

router.post(
  '/',
  upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'coverImage', maxCount: 1 }
  ]),
  storeController.createStore
);

router.put(
  '/my-store',
  upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'coverImage', maxCount: 1 }
  ]),
  storeController.updateMyStore
);

module.exports = router;