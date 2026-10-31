const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },

  // Basic Info
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true },
  description: { type: String, required: true },

  // Pricing & Inventory (Base)
  price: { type: Number, required: true },
  previousPrice: { type: Number }, // For discounts
  stock: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['available', 'limited', 'out_of_stock', 'sold_out', 'hidden'],
    default: 'available'
  },

  // Categorization
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: [true, 'Product must belong to a category']
  },
  customCollections: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Collection' }],
  tags: [{ type: String }],

  // Media (Cloudinary Data)
  images: [{
    public_id: { type: String, required: true },
    url: { type: String, required: true },
    isThumbnail: { type: Boolean, default: false }
  }],
  video: {
    public_id: String,
    url: String
  },

  // Dynamic attributes (variations)
  attributes: [{
    attributeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Attribute' },
    name: { type: String },
    value: { type: mongoose.Schema.Types.Mixed } // String, Number, Boolean, or Array
  }],

  // Reviews
reviews: [
  {
    customerName: { type: String, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    reply: {
      message: { type: String, trim: true, maxlength: 1000 },
      repliedAt: { type: Date },
    },
  },
],
  averageRating: { type: Number, default: 0 },
  totalReviews: { type: Number, default: 0 },

  // Metadata
  views: { type: Number, default: 0 },
  whatsappClicks: { type: Number, default: 0 },
  shares: { type: Number, default: 0 },
  isFeatured: { type: Boolean, default: false }

}, { timestamps: true });

productSchema.index({ name: 'text', description: 'text', tags: 'text' });
productSchema.index({ store: 1, category: 1 });

module.exports = mongoose.model('Product', productSchema);
