const express = require('express');
const rateLimit = require('express-rate-limit');
const storeController = require('../controllers/storeController');
const { protect } = require('../middleware/requireAuth');
const upload = require('../middleware/upload');

const router = express.Router();

const makeLimiter = (limit, error) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error },
  });

const resolveLimiter = makeLimiter(300, 'Too many requests. Please slow down.');
const checkLimiter = makeLimiter(60, 'Too many checks. Please wait a few minutes.');

// ==========================================
// PUBLIC ROUTES (storefront)
// ==========================================
router.get('/slug/:storeSlug', storeController.getStoreBySlug);
router.get('/short/:code', resolveLimiter, storeController.resolveShortCode);

// ==========================================
// PROTECTED ROUTES (vendor dashboard only)
// ==========================================
router.use(protect);

router.get('/my-store', storeController.getMyStore);
router.get('/short-code/check', checkLimiter, storeController.checkShortCode);
router.put('/short-code', storeController.setShortCode);

router.post(
  '/',
  upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'coverImage', maxCount: 1 },
  ]),
  storeController.createStore
);

router.put(
  '/my-store',
  upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'coverImage', maxCount: 1 },
  ]),
  storeController.updateMyStore
);

module.exports = router;