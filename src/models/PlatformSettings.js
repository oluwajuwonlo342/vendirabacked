const mongoose = require('mongoose');

const platformSettingsSchema = new mongoose.Schema({
  platformName: { type: String, default: 'Vendira' },
  supportEmail: { type: String, default: 'support@vendira.com' },
  maxProductsPerStore: { type: Number, default: 50 },
  platformFeePercentage: { type: Number, default: 2.5 },
  enableSignups: { type: Boolean, default: true },
  autoApproveStores: { type: Boolean, default: true },
  maintenanceMode: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('PlatformSettings', platformSettingsSchema);