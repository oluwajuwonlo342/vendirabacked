const User = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const sendEmail = require('../utils/sendEmail');

const RESET_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const signToken = (id, role) => {
  return jwt.sign({ id, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN
  });
};

const getUserId = (req) => req.user?._id || req.user?.id || req.userId || req.user;

const publicUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role,
});

exports.registerVendor = async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email is already registered' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      phone,
      role: 'VENDOR'
    });

    const token = signToken(user._id, user.role);

    res.status(201).json({
      status: 'success',
      token,
      data: { user: { id: user._id, name: user.name, email: user.email, role: user.role } }
    });
  } catch (error) {
    console.error('Register Error:', error);
    res.status(500).json({ error: 'Server error during registration' });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken(user._id, user.role);

    res.status(200).json({
      status: 'success',
      token,
      data: { user: { id: user._id, name: user.name, role: user.role } }
    });
  } catch (error) {
    console.error('Login Error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
};

exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(getUserId(req));
    if (!user) return res.status(404).json({ error: 'User not found.' });

    res.status(200).json({ status: 'success', data: { user: publicUser(user) } });
  } catch (error) {
    console.error('Get Me Error:', error);
    res.status(500).json({ error: 'Server error fetching profile.' });
  }
};

exports.updateDetails = async (req, res) => {
  try {
    const name = req.body.name?.trim();
    const email = req.body.email?.trim();

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required.' });
    }

    const userId = getUserId(req);

    const taken = await User.findOne({ email, _id: { $ne: userId } });
    if (taken) {
      return res.status(400).json({ error: 'That email is already in use.' });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { name, email },
      { new: true, runValidators: true }
    );
    if (!user) return res.status(404).json({ error: 'User not found.' });

    res.status(200).json({ status: 'success', data: { user: publicUser(user) } });
  } catch (error) {
    console.error('Update Details Error:', error);
    if (error.code === 11000) {
      return res.status(400).json({ error: 'That email is already in use.' });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: Object.values(error.errors)[0].message });
    }
    res.status(500).json({ error: 'Server error updating profile.' });
  }
};

exports.updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const user = await User.findById(getUserId(req)).select('+password');
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }

    user.password = await bcrypt.hash(newPassword, await bcrypt.genSalt(10));
    await user.save();

    res.status(200).json({ status: 'success', message: 'Password updated successfully.' });
  } catch (error) {
    console.error('Update Password Error:', error);
    res.status(500).json({ error: 'Server error updating password.' });
  }
};
exports.forgotPassword = async (req, res) => {
  // Same answer whether or not the account exists
  const genericResponse = {
    status: 'success',
    message: 'If an account with that email exists, a reset link has been sent.',
  };

  try {
    const email = req.body.email?.trim();
    if (!email) {
      return res.status(400).json({ error: 'Please enter your email address.' });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(200).json(genericResponse);

    const rawToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = hashToken(rawToken); // only the hash is stored
    user.resetPasswordExpires = new Date(Date.now() + RESET_WINDOW_MS);
    await user.save({ validateBeforeSave: false });

    const clientUrl = (process.env.CLIENT_URL || '').split(',')[0].trim().replace(/\/$/, '');
    const resetUrl = `${clientUrl}/reset-password/${rawToken}`;

    // Not awaited, so response time doesn't reveal whether the account exists
    sendEmail({
      to: user.email,
      subject: 'Reset your Vendira password',
      text: `Hi ${user.name || 'there'},\n\nUse this link to reset your password. It expires in 30 minutes:\n${resetUrl}\n\nIf you didn't request this, you can ignore this email.`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#111827">
          <h2 style="color:#128C7E">Reset your password</h2>
          <p>Hi ${user.name || 'there'},</p>
          <p>Click the button below to choose a new password. This link expires in 30 minutes.</p>
          <p style="margin:28px 0">
            <a href="${resetUrl}" style="background:#128C7E;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Reset password</a>
          </p>
          <p style="font-size:13px;color:#6b7280">Or paste this link into your browser:<br>${resetUrl}</p>
          <p style="font-size:13px;color:#6b7280">If you didn't request this, you can safely ignore this email.</p>
        </div>`,
    }).catch((err) => console.error('Reset email failed:', err.message));

    res.status(200).json(genericResponse);
  } catch (error) {
    console.error('Forgot Password Error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const user = await User.findOne({
      resetPasswordToken: hashToken(token),
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });
    }

    // Hashed manually, same as registerVendor and updatePassword
    user.password = await bcrypt.hash(password, await bcrypt.genSalt(10));
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save({ validateBeforeSave: false });

    res.status(200).json({ status: 'success', message: 'Password reset successful. You can now log in.' });
  } catch (error) {
    console.error('Reset Password Error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
