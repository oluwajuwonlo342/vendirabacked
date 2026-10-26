const express = require('express');
const guideController = require('../controllers/guideController');
const { protect } = require('../middleware/requireAuth');
const adminOnly = require('../middleware/adminOnly');
const upload = require('../middleware/upload');

const router = express.Router();

router.use(protect);

// Any logged-in vendor
router.get('/', guideController.getGuide);

// Admin only. adminOnly comes BEFORE upload so non-admins can never upload files.
router.get('/admin', adminOnly, guideController.getAdminGuide);
router.put('/admin/welcome', adminOnly, guideController.updateWelcome);
router.post('/admin/welcome/test', adminOnly, guideController.sendTest);
router.post('/admin/welcome/send', adminOnly, guideController.sendWelcomeToVendors);

router.post('/admin/tutorials', adminOnly, upload.single('video'), guideController.createTutorial);
router.put('/admin/tutorials/:id', adminOnly, upload.single('video'), guideController.updateTutorial);
router.delete('/admin/tutorials/:id', adminOnly, guideController.deleteTutorial);

module.exports = router;
