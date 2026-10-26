const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const Tutorial = require('../models/Tutorial');
const WelcomeMessage = require('../models/WelcomeMessage');
const User = require('../models/User');
const sendEmail = require('../utils/sendEmail');

const getUserId = (req) => req.user?._id || req.user?.id || req.userId || req.user;
const VENDOR_FILTER = { role: { $nin: ['ADMIN', 'admin'] } };
const BATCH_LIMIT = 250; // Brevo's free plan allows about 300 emails a day

const escapeHtml = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clientBase = () => (process.env.CLIENT_URL || '').split(',')[0].trim().replace(/\/$/, '');
const personalise = (text = '', name) => text.replace(/\{\{\s*name\s*\}\}/gi, name || 'there');
const isHttps = (u) => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };

const getWelcome = () =>
  WelcomeMessage.findOneAndUpdate(
    { key: 'default' },
    { $setOnInsert: { key: 'default' } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

const destroyVideo = async (publicId) => {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'video' });
  } catch (err) {
    console.error('Cloudinary cleanup failed:', err.message);
  }
};

// Multer uploads before the controller runs, so rejected requests must delete their fresh upload
const discardUpload = (req) => (req.file ? destroyVideo(req.file.filename) : null);

const inChunks = async (items, size, fn) => {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
};

// ==========================================
// Welcome email (also used by registerVendor)
// ==========================================
const sendWelcomeEmail = async (user, { force = false, markSent = true } = {}) => {
  const welcome = await getWelcome();
  if (!force && !welcome.sendOnRegister) return false;

  const tutorials = await Tutorial.find({ isPublished: true })
    .sort({ order: 1, createdAt: 1 })
    .select('title')
    .limit(8);

  const link = `${clientBase()}/dashboard/guide`;
  const message = personalise(welcome.message, user.name);
  const listHtml = tutorials.length
    ? `<p style="margin:20px 0 6px;font-weight:bold">What you'll learn:</p><ul style="padding-left:20px;margin:0">${tutorials
        .map((t) => `<li style="margin:4px 0">${escapeHtml(t.title)}</li>`)
        .join('')}</ul>`
    : '';
  const listText = tutorials.length ? `\n\nWhat you'll learn:\n${tutorials.map((t) => `- ${t.title}`).join('\n')}` : '';

  await sendEmail({
    to: user.email,
    subject: welcome.subject,
    text: `${message}${listText}\n\nWatch the tutorials: ${link}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#111827;line-height:1.55">
        <h2 style="color:#128C7E">${escapeHtml(welcome.subject)}</h2>
        <p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
        ${listHtml}
        <p style="margin:28px 0">
          <a href="${link}" style="background:#128C7E;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Watch the tutorials</a>
        </p>
        <p style="font-size:13px;color:#6b7280">Or open this link: ${link}</p>
      </div>`,
  });

  if (markSent) await User.updateOne({ _id: user._id }, { welcomeEmailSentAt: new Date() });
  return true;
};
exports.sendWelcomeEmail = sendWelcomeEmail;

// ==========================================
// VENDOR: welcome message + published tutorials
// ==========================================
exports.getGuide = async (req, res) => {
  try {
    const [welcome, tutorials, user] = await Promise.all([
      getWelcome(),
      Tutorial.find({ isPublished: true }).sort({ order: 1, createdAt: 1 }),
      User.findById(getUserId(req)).select('name'),
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        welcome: { subject: welcome.subject, message: personalise(welcome.message, user?.name) },
        tutorials,
      },
    });
  } catch (error) {
    console.error('Get Guide Error:', error);
    res.status(500).json({ error: 'Server error loading the guide.' });
  }
};

// ==========================================
// ADMIN: everything + stats
// ==========================================
exports.getAdminGuide = async (req, res) => {
  try {
    const [welcome, tutorials, vendors, pending] = await Promise.all([
      getWelcome(),
      Tutorial.find().sort({ order: 1, createdAt: 1 }),
      User.countDocuments(VENDOR_FILTER),
      User.countDocuments({ ...VENDOR_FILTER, welcomeEmailSentAt: null }),
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        welcome: { subject: welcome.subject, message: welcome.message, sendOnRegister: welcome.sendOnRegister },
        tutorials,
        stats: { vendors, pending },
      },
    });
  } catch (error) {
    console.error('Get Admin Guide Error:', error);
    res.status(500).json({ error: 'Server error loading the guide.' });
  }
};

// ==========================================
// ADMIN: edit the welcome message
// ==========================================
exports.updateWelcome = async (req, res) => {
  try {
    const subject = req.body.subject?.trim();
    const message = req.body.message?.trim();

    if (!subject) return res.status(400).json({ error: 'The email needs a subject.' });
    if (!message) return res.status(400).json({ error: 'Write a welcome message.' });
    if (subject.length > 150) return res.status(400).json({ error: 'Subject is too long (maximum 150 characters).' });
    if (message.length > 3000) return res.status(400).json({ error: 'Message is too long (maximum 3000 characters).' });

    const welcome = await getWelcome();
    welcome.subject = subject;
    welcome.message = message;
    welcome.sendOnRegister = req.body.sendOnRegister === true || req.body.sendOnRegister === 'true';
    await welcome.save();

    res.status(200).json({ status: 'success', data: { welcome } });
  } catch (error) {
    console.error('Update Welcome Error:', error);
    res.status(500).json({ error: 'Server error saving the welcome message.' });
  }
};

// ==========================================
// ADMIN: preview email sent to yourself
// ==========================================
exports.sendTest = async (req, res) => {
  try {
    const admin = await User.findById(getUserId(req)).select('name email');
    if (!admin) return res.status(404).json({ error: 'Account not found.' });

    await sendWelcomeEmail(admin, { force: true, markSent: false });
    res.status(200).json({ status: 'success', message: `A test email was sent to ${admin.email}.` });
  } catch (error) {
    console.error('Send Test Error:', error);
    res.status(500).json({ error: `Could not send the test email: ${error.message}` });
  }
};

// ==========================================
// ADMIN: send the welcome email to existing vendors
// ==========================================
exports.sendWelcomeToVendors = async (req, res) => {
  try {
    const audience = req.body.audience === 'all' ? 'all' : 'pending';
    const filter = audience === 'all' ? VENDOR_FILTER : { ...VENDOR_FILTER, welcomeEmailSentAt: null };

    const total = await User.countDocuments(filter);
    const users = await User.find(filter).select('name email welcomeEmailSentAt').sort({ createdAt: 1 }).limit(BATCH_LIMIT);

    let sent = 0;
    let failed = 0;
    await inChunks(users, 5, async (user) => {
      try {
        await sendWelcomeEmail(user, { force: true });
        sent += 1;
      } catch (err) {
        failed += 1;
        console.error(`Welcome email to ${user.email} failed:`, err.message);
      }
    });

    // "all" re-sends to everyone, so it only reports what was left over after this batch
    const remaining = audience === 'pending' ? Math.max(total - sent, 0) : Math.max(total - users.length, 0);
    res.status(200).json({ status: 'success', data: { sent, failed, remaining } });
  } catch (error) {
    console.error('Send Welcome Error:', error);
    res.status(500).json({ error: 'Server error sending emails.' });
  }
};

// ==========================================
// ADMIN: tutorials
// ==========================================
exports.createTutorial = async (req, res) => {
  const fail = async (code, error) => {
    await discardUpload(req);
    return res.status(code).json({ error });
  };

  try {
    const title = req.body.title?.trim();
    if (!title) return fail(400, 'Give the tutorial a title.');

    let videoUrl = req.body.videoUrl?.trim();
    let video;
    if (req.file) {
      videoUrl = req.file.path;
      video = { public_id: req.file.filename };
    } else if (!videoUrl || !isHttps(videoUrl)) {
      return fail(400, 'Paste a video link that starts with https:// or upload a video file.');
    }

    const hasOrder = req.body.order !== undefined && req.body.order !== '';
    const order = hasOrder ? Number(req.body.order) || 0 : (await Tutorial.countDocuments()) + 1;

    const tutorial = await Tutorial.create({
      title,
      description: req.body.description?.trim(),
      videoUrl,
      video,
      order,
      isPublished: req.body.isPublished !== 'false',
    });

    res.status(201).json({ status: 'success', data: { tutorial } });
  } catch (error) {
    console.error('Create Tutorial Error:', error);
    await discardUpload(req);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: Object.values(error.errors)[0].message });
    }
    res.status(500).json({ error: 'Server error saving the tutorial.' });
  }
};

exports.updateTutorial = async (req, res) => {
  let saved = false;
  const fail = async (code, error) => {
    await discardUpload(req);
    return res.status(code).json({ error });
  };

  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return fail(400, 'Invalid tutorial ID.');

    const tutorial = await Tutorial.findById(id);
    if (!tutorial) return fail(404, 'Tutorial not found.');

    if (req.body.title !== undefined) {
      if (!req.body.title.trim()) return fail(400, 'The title cannot be empty.');
      tutorial.title = req.body.title.trim();
    }
    if (req.body.description !== undefined) tutorial.description = req.body.description.trim();
    if (req.body.order !== undefined && req.body.order !== '') tutorial.order = Number(req.body.order) || 0;
    if (req.body.isPublished !== undefined) {
      tutorial.isPublished = req.body.isPublished === true || req.body.isPublished === 'true';
    }

    let oldUploadId = null;
    const newLink = req.body.videoUrl?.trim();
    if (req.file) {
      oldUploadId = tutorial.video?.public_id;
      tutorial.videoUrl = req.file.path;
      tutorial.video = { public_id: req.file.filename };
    } else if (newLink && newLink !== tutorial.videoUrl) {
      if (!isHttps(newLink)) return fail(400, 'The video link must start with https://');
      oldUploadId = tutorial.video?.public_id;
      tutorial.videoUrl = newLink;
      tutorial.set('video', undefined);
    }

    await tutorial.save();
    saved = true;
    await destroyVideo(oldUploadId); // only after the save succeeded

    res.status(200).json({ status: 'success', data: { tutorial } });
  } catch (error) {
    console.error('Update Tutorial Error:', error);
    if (!saved) await discardUpload(req);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: Object.values(error.errors)[0].message });
    }
    res.status(500).json({ error: 'Server error updating the tutorial.' });
  }
};

exports.deleteTutorial = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid tutorial ID.' });

    const tutorial = await Tutorial.findByIdAndDelete(id);
    if (!tutorial) return res.status(404).json({ error: 'Tutorial not found.' });

    await destroyVideo(tutorial.video?.public_id);
    res.status(200).json({ status: 'success', message: 'Tutorial deleted.' });
  } catch (error) {
    console.error('Delete Tutorial Error:', error);
    res.status(500).json({ error: 'Server error deleting the tutorial.' });
  }
};
