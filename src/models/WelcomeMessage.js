const mongoose = require('mongoose');

// A single document that holds the welcome message everyone receives
const welcomeSchema = new mongoose.Schema({
  key: { type: String, default: 'default', unique: true },
  subject: { type: String, default: 'Welcome to Vendira!', trim: true, maxlength: 150 },
  message: {
    type: String,
    trim: true,
    maxlength: 3000,
    default:
      "Hi {{name}},\n\nWelcome to Vendira! We're glad you're here. In a few minutes you can have your own online shop that sends orders straight to your WhatsApp.\n\nWatch the short video tutorials to get started. If you get stuck, send us a message from the Feedback page and we'll help.",
  },
  sendOnRegister: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('WelcomeMessage', welcomeSchema);
