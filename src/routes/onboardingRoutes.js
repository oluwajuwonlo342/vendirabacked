const express = require('express');
const controller = require('../controllers/onboardingController');
const { protect } = require('../middleware/requireAuth');
const upload = require('../middleware/upload');

const router = express.Router();

// Public (protected by their own token or secret, not by login)
router.get('/unsubscribe', controller.unsubscribe);
router.post('/cron/reminders', controller.sendReminders);

// Vendor
router.use(protect);
router.get('/', controller.getOnboarding);
router.put(
  '/store',
  upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'coverImage', maxCount: 1 }]),
  controller.saveStore
);
router.post('/product', upload.fields([{ name: 'images', maxCount: 5 }]), controller.createFirstProduct);
router.put('/publish', controller.setPublished);

module.exports = router;
