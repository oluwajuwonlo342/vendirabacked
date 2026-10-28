const mongoose = require('mongoose');

const whatsappStatSchema = new mongoose.Schema({
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  day: { type: String, required: true }, // YYYY-MM-DD in Nigerian time
  clicks: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

whatsappStatSchema.index({ store: 1, product: 1, day: 1 }, { unique: true });
whatsappStatSchema.index({ createdAt: 1 }, { expireAfterSeconds: 400 * 24 * 60 * 60 }); // keep about 13 months

module.exports = mongoose.model('WhatsAppStat', whatsappStatSchema);
