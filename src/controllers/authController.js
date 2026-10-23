const User = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

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