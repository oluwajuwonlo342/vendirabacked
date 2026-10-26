const mongoose = require('mongoose');

const tutorialSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, trim: true, maxlength: 500 },
  videoUrl: { type: String, required: true, trim: true },
  video: { public_id: String }, // only set for uploaded files, so they can be deleted later
  order: { type: Number, default: 0 },
  isPublished: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('Tutorial', tutorialSchema);
