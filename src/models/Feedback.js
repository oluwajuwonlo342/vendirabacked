const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' },

  rating: { type: Number, required: true, min: 1, max: 5 },
  type: { type: String, enum: ['review', 'suggestion', 'bug', 'other'], default: 'review' },
  message: { type: String, required: true, trim: true, maxlength: 1000 },

  status: { type: String, enum: ['new', 'reviewed', 'resolved'], default: 'new', index: true },
  adminReply: {
    message: { type: String, trim: true, maxlength: 2000 },
    repliedAt: Date,
  },
}, { timestamps: true });

module.exports = mongoose.model('Feedback', feedbackSchema);
