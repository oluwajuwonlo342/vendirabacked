const express = require('express');
const shareController = require('../controllers/shareControllers');

const router = express.Router();

router.get('/store/:slug', shareController.shareStore);
router.get('/c/:code', shareController.shareShort);

module.exports = router;
