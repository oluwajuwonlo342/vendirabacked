const mongoose = require('mongoose');

const emailSendSchema = new mongoose.Schema({
  templateKey: { type: String, required: true }, // the template's id as text
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sentAt: { type: Date, default: Date.now },
});

emailSendSchema.index({ templateKey: 1, user: 1 }, { unique: true });

module.exports = mongoose.model('EmailSend', emailSendSchema);
