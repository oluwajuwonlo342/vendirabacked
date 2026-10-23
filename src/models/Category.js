const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a category name'],
    trim: true,
    maxlength: [50, 'Category name cannot be more than 50 characters']
  },
  slug: {
    type: String,
    lowercase: true
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot be more than 500 characters']
  },
  store: {
    type: mongoose.Schema.ObjectId,
    ref: 'Store',
    required: [true, 'Category must belong to a store']
  },
  user: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: [true, 'Category must belong to a user/vendor']
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound index to ensure a store cannot have duplicate category slugs,
// but two different stores CAN have a category with the same name (e.g., "Shirts").
categorySchema.index({ store: 1, slug: 1 }, { unique: true });

// Pre-save middleware to automatically generate a URL-friendly slug from the category name
// Pre-save middleware to automatically generate a URL-friendly slug from the category name
// Pre-save middleware to automatically generate a URL-friendly slug from the category name
categorySchema.pre('save', async function() {
  if (this.isModified('name')) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric characters with hyphens
      .replace(/(^-|-$)+/g, '');   // Remove leading or trailing hyphens
  }
});

// Virtual populate to fetch all products within this category
categorySchema.virtual('products', {
  ref: 'Product',
  localField: '_id',
  foreignField: 'category',
  justOne: false
});

module.exports = mongoose.model('Category', categorySchema);