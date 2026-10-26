const User = require('../models/User');

const getUserId = (req) => req.user?._id || req.user?.id || req.userId || req.user;

// Run after `protect`. Reads the role from the database, not from the token.
module.exports = async (req, res, next) => {
  try {
    const user = await User.findById(getUserId(req)).select('role');
    if (!user || String(user.role).toUpperCase() !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin access only.' });
    }
    next();
  } catch (error) {
    console.error('adminOnly error:', error);
    res.status(500).json({ error: 'Server error.' });
  }
};
