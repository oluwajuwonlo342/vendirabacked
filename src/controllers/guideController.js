const crypto = require('crypto');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const Tutorial = require('../models/Tutorial');
const WelcomeMessage = require('../models/WelcomeMessage');
const EmailTemplate = require('../models/EmailTemplate');
const EmailSend = require('../models/EmailSend');
const User = require('../models/User');
const Store = require('../models/Store');
const Product = require('../models/Product');
const sendEmail = require('../utils/sendEmail');

const DAY = 24 * 60 * 60 * 1000;
const BATCH_LIMIT = 250; // Brevo's free plan allows about 300 emails a day
const VENDOR_FILTER = { role: { $nin: ['ADMIN', 'admin'] } };
const AUDIENCES = ['latest', 'recent', 'all', 'no-store', 'no-product'];

// ---------- small helpers ----------
const getUserId = (req) => req.user?._id || req.user?.id || req.userId || req.user;
const readBool = (value) => (value === undefined ? undefined : value === true || value === 'true');
const clampInt = (value, min, max, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
};
const escapeHtml = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clientBase = () => (process.env.CLIENT_URL || '').split(',')[0].trim().replace(/\/$/, '');
const apiBase = () => (process.env.API_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
const personalise = (text = '', name) => text.replace(/\{\{\s*name\s*\}\}/gi, name || 'there');
const isHttps = (u) => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };
const unsubToken = (userId) =>
  crypto.createHmac('sha256', process.env.JWT_SECRET || '').update(String(userId)).digest('hex');

const inChunks = async (items, size, fn) => {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
};

const getWelcome = () =>
  WelcomeMessage.findOneAndUpdate(
    { key: 'default' },
    { $setOnInsert: { key: 'default' } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

const getTutorialTitles = async (limit = 8) => {
  const rows = await Tutorial.find({ isPublished: true })
    .sort({ order: 1, createdAt: 1 })
    .select('title')
    .limit(limit)
    .lean();
  return rows.map((r) => r.title);
};

const destroyVideo = async (publicId) => {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'video' });
  } catch (err) {
    console.error('Cloudinary cleanup failed:', err.message);
  }
};
const discardUpload = (req) => (req.file ? destroyVideo(req.file.filename) : null);

// ---------- templates: the welcome email and your own ----------
const welcomeTemplate = (welcome) => ({
  key: 'welcome',
  kind: 'welcome',
  name: 'Welcome email',
  subject: welcome.subject,
  message: welcome.message,
  includeTutorials: welcome.includeTutorialsOnRegister !== false,
  button: null,
});

const customTemplate = (doc) => ({
  key: String(doc._id),
  kind: 'custom',
  name: doc.name,
  subject: doc.subject,
  message: doc.message,
  includeTutorials: Boolean(doc.includeTutorials),
  button: doc.buttonLabel && doc.buttonUrl ? { label: doc.buttonLabel, url: doc.buttonUrl } : null,
});

const loadTemplate = async (id) => {
  if (!id || id === 'welcome') return welcomeTemplate(await getWelcome());
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const doc = await EmailTemplate.findById(id).lean();
  return doc ? customTemplate(doc) : null;
};

// ---------- building and sending an email ----------
const buildEmail = (tpl, user, tutorialTitles) => {
  const hasTutorials = tutorialTitles.length > 0;
  const guideLink = `${clientBase()}/dashboard/guide`;

  let button = null;
  if (tpl.button) {
    button = {
      label: tpl.button.label,
      url: tpl.button.url.startsWith('/') ? `${clientBase()}${tpl.button.url}` : tpl.button.url,
    };
  } else if (hasTutorials) {
    button = { label: 'Watch the tutorials', url: guideLink };
  } else if (tpl.kind === 'welcome') {
    button = { label: 'Go to my dashboard', url: `${clientBase()}/dashboard` };
  }

  // When the button goes somewhere else, still give a plain link to the tutorials
  const showGuideLine = hasTutorials && button && button.url !== guideLink;
  const subject = personalise(tpl.subject, user.name);
  const body = personalise(tpl.message, user.name);

  // Announcements carry a one-click opt-out. The welcome email is a one-off and doesn't need it.
  const unsubscribe =
    tpl.kind === 'custom' ? `${apiBase()}/api/onboarding/unsubscribe?u=${user._id}&t=${unsubToken(user._id)}` : '';

  const listText = hasTutorials ? `\n\nWhat you'll learn:\n${tutorialTitles.map((t) => `- ${t}`).join('\n')}` : '';
  const text = [
    `${body}${listText}`,
    button ? `${button.label}: ${button.url}` : '',
    showGuideLine ? `Watch the tutorials: ${guideLink}` : '',
    unsubscribe ? `Stop these emails: ${unsubscribe}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const listHtml = hasTutorials
    ? `<p style="margin:20px 0 6px;font-weight:bold">What you'll learn:</p><ul style="padding-left:20px;margin:0">${tutorialTitles
        .map((t) => `<li style="margin:4px 0">${escapeHtml(t)}</li>`)
        .join('')}</ul>`
    : '';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#111827;line-height:1.55">
      <h2 style="color:#128C7E">${escapeHtml(subject)}</h2>
      <p>${escapeHtml(body).replace(/\n/g, '<br>')}</p>
      ${listHtml}
      ${button ? `<p style="margin:28px 0"><a href="${escapeHtml(button.url)}" style="background:#128C7E;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">${escapeHtml(button.label)}</a></p>` : ''}
      ${showGuideLine ? `<p style="font-size:13px;color:#6b7280">Tutorial videos: <a href="${guideLink}" style="color:#128C7E">${guideLink}</a></p>` : ''}
      ${unsubscribe ? `<p style="font-size:12px;color:#6b7280;margin-top:24px">You get this because you have a Vendira account. <a href="${unsubscribe}" style="color:#6b7280">Stop these emails</a>.</p>` : ''}
    </div>`;

  return { subject, text, html };
};

// record: false for test emails, so a test never counts as "sent"
const deliver = async (user, tpl, { tutorialTitles = [], record = true } = {}) => {
  await sendEmail({ to: user.email, ...buildEmail(tpl, user, tutorialTitles) });
  if (!record) return;

  if (tpl.kind === 'welcome') {
    await User.updateOne({ _id: user._id }, { welcomeEmailSentAt: new Date() });
  } else {
    await EmailSend.updateOne({ templateKey: tpl.key, user: user._id }, { $set: { sentAt: new Date() } }, { upsert: true });
  }
};

// Used by registerVendor: honours the "send automatically" switch
const sendWelcomeEmail = async (user, { force = false, markSent = true, includeTutorials } = {}) => {
  const welcome = await getWelcome();
  if (!force && !welcome.sendOnRegister) return false;

  const tpl = welcomeTemplate(welcome);
  const want = includeTutorials === undefined ? tpl.includeTutorials : Boolean(includeTutorials);
  await deliver(user, tpl, { tutorialTitles: want ? await getTutorialTitles() : [], record: markSent });
  return true;
};
exports.sendWelcomeEmail = sendWelcomeEmail;

// ---------- who gets a message ----------
const readAudience = (body) => ({
  audience: AUDIENCES.includes(body.audience) ? body.audience : 'latest',
  count: clampInt(body.count, 1, BATCH_LIMIT, 5),
  days: clampInt(body.days, 1, 90, 7),
  skipAlreadySent: readBool(body.skipAlreadySent) !== false,
});

// Everyone who already got this template. With "skip" off, only people emailed in the last 24 hours,
// which protects against double clicks and lets big sends continue in batches.
const alreadySentSet = async (templateKey, skipAlreadySent) => {
  const since = new Date(Date.now() - DAY);
  const ids =
    templateKey === 'welcome'
      ? await User.distinct('_id', { welcomeEmailSentAt: skipAlreadySent ? { $ne: null } : { $gte: since } })
      : await EmailSend.distinct('user', skipAlreadySent ? { templateKey } : { templateKey, sentAt: { $gte: since } });
  return new Set(ids.map(String));
};

const resolveAudience = async (tpl, { audience, count, days, skipAlreadySent }) => {
  const filter = { ...VENDOR_FILTER };
  let sort = { createdAt: 1 };
  let limit = 5000;

  if (audience === 'latest') {
    sort = { createdAt: -1 };
    limit = count; // the newest N sign-ups, chosen BEFORE removing anyone who already got it
  } else if (audience === 'recent') {
    filter.createdAt = { $gte: new Date(Date.now() - days * DAY) };
  } else if (audience === 'no-store') {
    filter._id = { $nin: await Store.distinct('vendor') };
  } else if (audience === 'no-product') {
    filter._id = { $in: await Store.distinct('vendor'), $nin: await Product.distinct('vendor') };
  }

  const segment = await User.find(filter).select('name email remindersOptOut').sort(sort).limit(limit).lean();
  const sentSet = await alreadySentSet(tpl.key, skipAlreadySent);

  const recipients = [];
  let alreadySent = 0;
  let optedOut = 0;
  for (const user of segment) {
    if (!user.email) continue;
    if (tpl.kind === 'custom' && user.remindersOptOut) { optedOut += 1; continue; }
    if (sentSet.has(String(user._id))) { alreadySent += 1; continue; }
    recipients.push(user);
  }
  return { total: segment.length, alreadySent, optedOut, recipients };
};

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
// ADMIN: everything the page needs
// ==========================================
exports.getAdminGuide = async (req, res) => {
  try {
    const [welcome, templates, tutorials, vendors, welcomeNotSent, sentCounts] = await Promise.all([
      getWelcome(),
      EmailTemplate.find().sort({ createdAt: -1 }).lean(),
      Tutorial.find().sort({ order: 1, createdAt: 1 }),
      User.countDocuments(VENDOR_FILTER),
      User.countDocuments({ ...VENDOR_FILTER, welcomeEmailSentAt: null }),
      EmailSend.aggregate([{ $group: { _id: '$templateKey', n: { $sum: 1 } } }]),
    ]);
    const sentBy = Object.fromEntries(sentCounts.map((c) => [c._id, c.n]));

    res.status(200).json({
      status: 'success',
      data: {
        welcome: {
          subject: welcome.subject,
          message: welcome.message,
          sendOnRegister: welcome.sendOnRegister,
          includeTutorialsOnRegister: welcome.includeTutorialsOnRegister !== false,
        },
        templates: templates.map((t) => ({ ...t, sentCount: sentBy[String(t._id)] || 0 })),
        tutorials,
        stats: {
          vendors,
          welcomeNotSent,
          publishedTutorials: tutorials.filter((t) => t.isPublished).length,
          batchLimit: BATCH_LIMIT,
        },
      },
    });
  } catch (error) {
    console.error('Get Admin Guide Error:', error);
    res.status(500).json({ error: 'Server error loading the guide.' });
  }
};

// ==========================================
// ADMIN: the welcome email and its automatic sending
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
    welcome.sendOnRegister = readBool(req.body.sendOnRegister) === true;
    welcome.includeTutorialsOnRegister = readBool(req.body.includeTutorialsOnRegister) !== false;
    await welcome.save();

    res.status(200).json({ status: 'success', data: { welcome } });
  } catch (error) {
    console.error('Update Welcome Error:', error);
    res.status(500).json({ error: 'Server error saving the welcome message.' });
  }
};

// ==========================================
// ADMIN: your own message templates
// ==========================================
const readTemplate = (b) => {
  const name = String(b.name ?? '').trim();
  const subject = String(b.subject ?? '').trim();
  const message = String(b.message ?? '').trim();
  const buttonLabel = String(b.buttonLabel ?? '').trim();
  const buttonUrl = String(b.buttonUrl ?? '').trim();

  if (!name) return { error: 'Give the template a name.' };
  if (name.length > 80) return { error: 'The name is too long (maximum 80 characters).' };
  if (!subject) return { error: 'The email needs a subject.' };
  if (subject.length > 150) return { error: 'Subject is too long (maximum 150 characters).' };
  if (!message) return { error: 'Write the message.' };
  if (message.length > 3000) return { error: 'Message is too long (maximum 3000 characters).' };
  if (Boolean(buttonLabel) !== Boolean(buttonUrl)) {
    return { error: 'Add both a button label and a button link, or leave both empty.' };
  }
  if (buttonLabel.length > 40) return { error: 'The button label is too long (maximum 40 characters).' };
  if (buttonUrl && !(isHttps(buttonUrl) || /^\/(?!\/)/.test(buttonUrl))) {
    return { error: 'The button link must start with https:// or with / (for a page in the app, like /dashboard/products).' };
  }

  return {
    data: { name, subject, message, buttonLabel, buttonUrl, includeTutorials: readBool(b.includeTutorials) === true },
  };
};

exports.createTemplate = async (req, res) => {
  try {
    const parsed = readTemplate(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const template = await EmailTemplate.create(parsed.data);
    res.status(201).json({ status: 'success', data: { template: { ...template.toObject(), sentCount: 0 } } });
  } catch (error) {
    console.error('Create Template Error:', error);
    res.status(500).json({ error: 'Server error saving the template.' });
  }
};

exports.updateTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid template ID.' });

    const parsed = readTemplate(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const template = await EmailTemplate.findByIdAndUpdate(id, { $set: parsed.data }, { new: true, runValidators: true });
    if (!template) return res.status(404).json({ error: 'Template not found.' });

    const sentCount = await EmailSend.countDocuments({ templateKey: String(id) });
    res.status(200).json({ status: 'success', data: { template: { ...template.toObject(), sentCount } } });
  } catch (error) {
    console.error('Update Template Error:', error);
    res.status(500).json({ error: 'Server error saving the template.' });
  }
};

exports.deleteTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid template ID.' });

    const template = await EmailTemplate.findByIdAndDelete(id);
    if (!template) return res.status(404).json({ error: 'Template not found.' });

    await EmailSend.deleteMany({ templateKey: String(id) });
    res.status(200).json({ status: 'success', message: 'Template deleted.' });
  } catch (error) {
    console.error('Delete Template Error:', error);
    res.status(500).json({ error: 'Server error deleting the template.' });
  }
};

// ==========================================
// ADMIN: how many people would get this message?
// ==========================================
exports.previewAudience = async (req, res) => {
  try {
    const tpl = await loadTemplate(req.body.template);
    if (!tpl) return res.status(404).json({ error: 'That template no longer exists.' });

    const { total, alreadySent, optedOut, recipients } = await resolveAudience(tpl, readAudience(req.body));
    res.status(200).json({
      status: 'success',
      data: {
        total,
        alreadySent,
        optedOut,
        eligible: recipients.length,
        willSend: Math.min(recipients.length, BATCH_LIMIT),
        batchLimit: BATCH_LIMIT,
        sample: recipients.slice(0, 3).map((u) => u.name || u.email),
      },
    });
  } catch (error) {
    console.error('Preview Audience Error:', error);
    res.status(500).json({ error: 'Server error checking who would receive this.' });
  }
};

// ==========================================
// ADMIN: send a template to yourself first
// ==========================================
exports.sendTest = async (req, res) => {
  try {
    const tpl = await loadTemplate(req.body.template);
    if (!tpl) return res.status(404).json({ error: 'That template no longer exists.' });

    const admin = await User.findById(getUserId(req)).select('name email').lean();
    if (!admin) return res.status(404).json({ error: 'Account not found.' });

    const want = readBool(req.body.includeTutorials) ?? tpl.includeTutorials;
    await deliver(admin, tpl, { tutorialTitles: want ? await getTutorialTitles() : [], record: false });
    res.status(200).json({ status: 'success', message: `A test email was sent to ${admin.email}.` });
  } catch (error) {
    console.error('Send Test Error:', error);
    res.status(500).json({ error: `Could not send the test email: ${error.message}` });
  }
};

// ==========================================
// ADMIN: send a template to a group of vendors
// ==========================================
exports.sendMessage = async (req, res) => {
  try {
    const tpl = await loadTemplate(req.body.template);
    if (!tpl) return res.status(404).json({ error: 'That template no longer exists.' });

    const { alreadySent, optedOut, recipients } = await resolveAudience(tpl, readAudience(req.body));
    const batch = recipients.slice(0, BATCH_LIMIT);

    const want = readBool(req.body.includeTutorials) ?? tpl.includeTutorials;
    const tutorialTitles = want && batch.length ? await getTutorialTitles() : [];

    let sent = 0;
    let failed = 0;
    await inChunks(batch, 5, async (user) => {
      try {
        await deliver(user, tpl, { tutorialTitles });
        sent += 1;
      } catch (err) {
        failed += 1;
        console.error(`Email to ${user.email} failed:`, err.message);
      }
    });

    res.status(200).json({
      status: 'success',
      data: { sent, failed, remaining: recipients.length - batch.length, skipped: { alreadySent, optedOut } },
    });
  } catch (error) {
    console.error('Send Message Error:', error);
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
