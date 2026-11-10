const mongoose = require('mongoose');

const emailTemplateSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  subject: { type: String, required: true, trim: true, maxlength: 150 },
  message: { type: String, required: true, trim: true, maxlength: 3000 },
  includeTutorials: { type: Boolean, default: false },
  buttonLabel: { type: String, trim: true, maxlength: 40 },
  buttonUrl: { type: String, trim: true, maxlength: 500 },
}, { timestamps: true });

module.exports = mongoose.model('EmailTemplate', emailTemplateSchema);
