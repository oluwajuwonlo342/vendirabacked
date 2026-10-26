const mongoose = require('mongoose');
const Feedback = require('../models/Feedback');
const Store = require('../models/Store');
const sendEmail = require('../utils/sendEmail');

const getVendorId = (req) => req.user?._id || req.user?.id || req.userId || req.user;
const TYPES = ['review', 'suggestion', 'bug', 'other'];
const STATUSES = ['new', 'reviewed', 'resolved'];
const DAILY_LIMIT = 5;

const escapeHtml = (s = '') =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ==========================================
// VENDOR: submit feedback
// ==========================================
exports.createFeedback = async (req, res) => {
  try {
    const vendorId = getVendorId(req);
    const rating = Number(req.body.rating);
    const message = req.body.message?.trim();
    const type = TYPES.includes(req.body.type) ? req.body.type : 'review';

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Please choose a rating from 1 to 5 stars.' });
    }
    if (!message || message.length < 5) {
      return res.status(400).json({ error: 'Please write a few words about your experience.' });
    }
    if (message.length > 1000) {
      return res.status(400).json({ error: 'Your message is too long (maximum 1000 characters).' });
    }

    // Simple spam guard: a few submissions per vendor per day
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await Feedback.countDocuments({ vendor: vendorId, createdAt: { $gte: since } });
    if (recent >= DAILY_LIMIT) {
      return res.status(429).json({ error: 'You have sent several messages today. Please try again tomorrow.' });
    }

    const store = await Store.findOne({ vendor: vendorId }).select('_id');

    const feedback = await Feedback.create({
      vendor: vendorId,
      store: store?._id,
      rating,
      type,
      message,
    });

    res.status(201).json({ status: 'success', data: { feedback } });
  } catch (error) {
    console.error('Create Feedback Error:', error);
    res.status(500).json({ error: 'Server error sending feedback.' });
  }
};

// ==========================================
// VENDOR: my submissions (with admin replies)
// ==========================================
exports.getMyFeedback = async (req, res) => {
  try {
    const feedback = await Feedback.find({ vendor: getVendorId(req) })
      .sort({ createdAt: -1 })
      .limit(50);

    res.status(200).json({ status: 'success', data: { feedback } });
  } catch (error) {
    console.error('Get My Feedback Error:', error);
    res.status(500).json({ error: 'Server error fetching your feedback.' });
  }
};

// ==========================================
// ADMIN: list everything
// ==========================================
exports.getAllFeedback = async (req, res) => {
  try {
    const filter = STATUSES.includes(req.query.status) ? { status: req.query.status } : {};

    const [feedback, statsAgg] = await Promise.all([
      Feedback.find(filter)
        .populate('vendor', 'name email')
        .populate('store', 'businessName slug')
        .sort({ createdAt: -1 })
        .limit(200),
      Feedback.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            averageRating: { $avg: '$rating' },
            newCount: { $sum: { $cond: [{ $eq: ['$status', 'new'] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const s = statsAgg[0] || { total: 0, averageRating: 0, newCount: 0 };
    res.status(200).json({
      status: 'success',
      data: {
        feedback,
        stats: { total: s.total, newCount: s.newCount, averageRating: Number((s.averageRating || 0).toFixed(1)) },
      },
    });
  } catch (error) {
    console.error('Get All Feedback Error:', error);
    res.status(500).json({ error: 'Server error fetching feedback.' });
  }
};

// ==========================================
// ADMIN: reply and/or change status
// ==========================================
exports.replyToFeedback = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid feedback ID.' });
    }

    const feedback = await Feedback.findById(id).populate('vendor', 'name email');
    if (!feedback) return res.status(404).json({ error: 'Feedback not found.' });

    const replyText = req.body.message?.trim();
    const status = STATUSES.includes(req.body.status) ? req.body.status : null;

    if (!replyText && !status) {
      return res.status(400).json({ error: 'Write a reply or choose a status.' });
    }
    if (replyText && replyText.length > 2000) {
      return res.status(400).json({ error: 'Reply is too long (maximum 2000 characters).' });
    }

    const replyChanged = replyText && replyText !== feedback.adminReply?.message;

    if (replyText) {
      feedback.adminReply = { message: replyText, repliedAt: replyChanged ? new Date() : feedback.adminReply.repliedAt };
    }
    feedback.status = status || (replyText && feedback.status === 'new' ? 'reviewed' : feedback.status);
    await feedback.save();

    // Email the vendor when a new or edited reply is sent (not awaited)
    if (replyChanged && feedback.vendor?.email) {
      const clientUrl = (process.env.CLIENT_URL || '').split(',')[0].trim().replace(/\/$/, '');
      const link = `${clientUrl}/dashboard/feedback`;
      const safeName = escapeHtml(feedback.vendor.name || 'there');
      const safeReply = escapeHtml(replyText).replace(/\n/g, '<br>');

      sendEmail({
        to: feedback.vendor.email,
        subject: 'The Vendira team replied to your feedback',
        text: `Hi ${feedback.vendor.name || 'there'},\n\nThanks for your feedback. Our reply:\n\n${replyText}\n\nView it here: ${link}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#111827">
            <h2 style="color:#128C7E">We replied to your feedback</h2>
            <p>Hi ${safeName}, thanks for taking the time to write to us.</p>
            <blockquote style="border-left:4px solid #25D366;margin:16px 0;padding:8px 16px;background:#f0fdf4">${safeReply}</blockquote>
            <p><a href="${link}" style="color:#128C7E;font-weight:bold">View it in your dashboard</a></p>
          </div>`,
      }).catch((err) => console.error('Feedback reply email failed:', err.message));
    }

    res.status(200).json({ status: 'success', data: { feedback } });
  } catch (error) {
    console.error('Reply Feedback Error:', error);
    res.status(500).json({ error: 'Server error saving reply.' });
  }
};
