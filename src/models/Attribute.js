const mongoose = require('mongoose');

const attributeSchema = new mongoose.Schema({
  category: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Category', 
    required: true 
  },
  name: { type: String, required: true }, // e.g., "RAM", "Size", "Condition"
  type: { 
    type: String, 
    enum: ['text', 'textarea', 'number', 'boolean', 'select', 'multiselect', 'color'], 
    required: true 
  },
  options: [{ type: String }], // Array of options if type is 'select' or 'multiselect'
  isRequired: { type: Boolean, default: false },
  order: { type: Number, default: 0 } // For UI display ordering
}, { timestamps: true });

// Prevent duplicate attribute names within the same category
attributeSchema.index({ category: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Attribute', attributeSchema);