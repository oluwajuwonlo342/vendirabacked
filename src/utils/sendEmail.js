// Sends mail through Brevo's HTTPS API. Render's free plan blocks SMTP, so Nodemailer won't work there.
const sendEmail = async ({ to, subject, html, text }) => {
  const apiKey = process.env.BREVO_API_KEY;

  // Local development without a key: print the message instead of failing
  if (!apiKey && process.env.NODE_ENV !== 'production') {
    console.log(`\n[DEV EMAIL] To: ${to}\nSubject: ${subject}\n${text}\n`);
    return;
  }
  if (!apiKey || !process.env.EMAIL_FROM) {
    throw new Error('BREVO_API_KEY and EMAIL_FROM must be set');
  }

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({
      sender: { name: process.env.EMAIL_FROM_NAME || 'Vendira', email: process.env.EMAIL_FROM },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
    }),
  });

  if (!res.ok) {
    throw new Error(`Brevo responded ${res.status}: ${await res.text()}`);
  }
};

module.exports = sendEmail;
