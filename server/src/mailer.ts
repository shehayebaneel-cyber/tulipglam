import nodemailer from "nodemailer";

// Graceful email layer. If SMTP isn't configured (no SMTP_URL / SMTP_HOST),
// emails are logged to the console instead of sent — so the app works out of
// the box and the owner can plug in real credentials later without code changes.
type MailSettings = Record<string, string>;

function transport(settings: MailSettings) {
  const url = process.env.SMTP_URL || settings.smtpUrl;
  const host = process.env.SMTP_HOST || settings.smtpHost;
  if (url) return nodemailer.createTransport(url);
  if (host) {
    return nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT || settings.smtpPort || 587),
      secure: (process.env.SMTP_SECURE || settings.smtpSecure) === "true",
      auth: { user: process.env.SMTP_USER || settings.smtpUser || "", pass: process.env.SMTP_PASS || settings.smtpPass || "" },
    });
  }
  return null;
}

export async function sendMail(settings: MailSettings, to: string, subject: string, html: string) {
  if (!to) return;
  const from = process.env.SMTP_FROM || settings.emailFrom || `${settings.storeName || "TulipGlam"} <no-reply@tulipglam.com>`;
  const t = transport(settings);
  if (!t) { console.log(`[mail:not-configured] to=${to} subject="${subject}"`); return; }
  try { await t.sendMail({ from, to, subject, html }); }
  catch (e) { console.error("[mail:error]", (e as Error).message); }
}

const wrap = (storeName: string, body: string) => `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1e">
    <div style="background:#6c2a55;color:#fff;padding:18px 24px;border-radius:14px 14px 0 0;font-weight:600;font-size:18px">${storeName}</div>
    <div style="border:1px solid #eae7ec;border-top:none;border-radius:0 0 14px 14px;padding:24px">${body}</div>
    <p style="color:#8b8790;font-size:12px;text-align:center;margin-top:16px">Premium beauty, delivered across Lebanon · Cash on delivery</p>
  </div>`;

export function orderConfirmationEmail(storeName: string, name: string, number: string, total: string) {
  return wrap(storeName, `
    <h2 style="margin:0 0 8px;font-size:20px">Thank you, ${name}!</h2>
    <p style="margin:0 0 12px;color:#4b4750">Your order <strong>${number}</strong> has been received.</p>
    <p style="margin:0 0 12px;color:#4b4750">We'll confirm availability and reach you on WhatsApp to arrange delivery. Total (cash on delivery): <strong>${total}</strong>.</p>
    <p style="margin:0;color:#8b8790;font-size:13px">Orders are subject to product availability. If an item is unavailable, we'll contact you before dispatch.</p>`);
}

export function statusUpdateEmail(storeName: string, name: string, number: string, statusLabel: string, note: string) {
  return wrap(storeName, `
    <h2 style="margin:0 0 8px;font-size:20px">Order ${number} update</h2>
    <p style="margin:0 0 12px;color:#4b4750">Hi ${name}, your order status is now: <strong>${statusLabel}</strong>.</p>
    ${note ? `<p style="margin:0 0 12px;color:#4b4750">${note}</p>` : ""}
    <p style="margin:0;color:#8b8790;font-size:13px">Track your order any time with your order number.</p>`);
}
