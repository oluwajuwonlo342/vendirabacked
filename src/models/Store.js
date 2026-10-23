const mongoose = require('mongoose');

const storeSchema = new mongoose.Schema({
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  
  // Branding
  businessName: { type: String, required: true },
  slug: { type: String, required: true, unique: true, lowercase: true }, // platform.com/:slug
  description: { type: String },
  logo: { public_id: String, url: String },
  coverImage: { public_id: String, url: String },
  
  // Categories the store operates in (Supports multiple)
  categories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
  
  // Contact & Delivery
  whatsappNumber: { type: String, required: true }, // Crucial for platform functionality
  phoneNumber: { type: String },
  email: { type: String },
  location: {
    country: { type: String, default: 'Nigeria' },
    state: String,
    city: String,
    address: String
  },
  
  deliverySettings: {
    pickupAvailable: { type: Boolean, default: true },
    deliveryAvailable: { type: Boolean, default: true },
    deliveryInfo: String // e.g., "Nationwide delivery via GIG..."
  },
  
  // Operations
  businessHours: {
    monday: { open: String, close: String, isClosed: { type: Boolean, default: false } },
    tuesday: { open: String, close: String, isClosed: { type: Boolean, default: false } },
    // ... other days
  },
  announcement: {
    message: String,
    isActive: { type: Boolean, default: false }
  },
    vendor: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  },

  // Verification & Status
  isVerified: { type: Boolean, default: false },
  status: { type: String, enum: ['active', 'suspended', 'banned'], default: 'active' },
  theme: { type: String, default: 'default' }
  
}, { timestamps: true });

module.exports = mongoose.model('Store', storeSchema);