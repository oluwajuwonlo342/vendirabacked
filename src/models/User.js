const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true, 
    trim: true 
  },
  email: { 
    type: String, 
    required: true, 
    unique: true, 
    trim: true,
    lowercase: true 
  },
  password: { 
    type: String, 
    required: true,
    select: false // Automatically hide password in query results for security
  },
  phone: { 
    type: String 
  },
  role: { 
    type: String, 
    enum: ['CUSTOMER', 'VENDOR', 'ADMIN', 'SUPER_ADMIN'], 
    default: 'CUSTOMER' 
  },
  resetPasswordToken: { type: String, select: false },
resetPasswordExpires: { type: Date, select: false },
  isActive: { 
    type: Boolean, 
    default: true 
  }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
