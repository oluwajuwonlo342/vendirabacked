const express = require('express');
const {
  createCategory,
  getCategories,
  updateCategory,
  deleteCategory
} = require('../controllers/categoryController');

// Import your authentication middleware
const { protect } = require('../middleware/requireAuth');

const router = express.Router();

// Apply the 'protect' middleware to all category routes
router.use(protect);

router.route('/')
  .get(getCategories)
  .post(createCategory);

router.route('/:id')
  .put(updateCategory)
  .delete(deleteCategory);

module.exports = router;