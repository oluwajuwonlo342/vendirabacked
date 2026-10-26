const express = require('express');
const feedbackController = require('../controllers/feedbackController');
const { protect } = require('../middleware/requireAuth');
const adminOnly = require('../middleware/adminOnly');

const router = express.Router();

router.use(protect);

// Vendor
router.post('/', feedbackController.createFeedback);
router.get('/mine', feedbackController.getMyFeedback);

// Admin
router.get('/admin', adminOnly, feedbackController.getAllFeedback);
router.put('/admin/:id', adminOnly, feedbackController.replyToFeedback);

module.exports = router;
