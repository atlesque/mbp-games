import { esc } from './util.js';

// ================= SIGN-IN EMAIL =================
// Sent through Cloudflare Email Service (the EMAIL binding). Without the binding (local dev, tests)
// the link is logged instead, so sign-in still works on a laptop.
export function signInEmail({ link, gameName, minutes }) {
  const what = gameName ? `to keep playing ${gameName}` : 'to your MBP Games account';
  const text = `Sign in ${what}:\n\n${link}\n\nThe link works once and runs out in ${minutes} minutes. `
    + `Opening it also confirms this email address for your MBP Games account.\n\nDidn't ask for this? Ignore this email; nobody gets in without the link.`;
  const html = `<!doctype html><html><body style="margin:0;background:#140c26;font-family:Arial,Helvetica,sans-serif;color:#f6f1e7">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#140c26;padding:32px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#22163d;border:1px solid #ff4fa3;border-radius:8px;padding:28px">
<tr><td style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:#3ef0ff">MBP Games</td></tr>
<tr><td style="padding:14px 0 6px;font-size:22px;font-weight:bold">Sign in ${esc(what)}</td></tr>
<tr><td style="padding:6px 0 22px;font-size:15px;line-height:1.5;color:#d9cfe8">Press the button to sign in. It also confirms this email address for your MBP Games account.</td></tr>
<tr><td><a href="${esc(link)}" style="display:inline-block;background:#ff4fa3;color:#140c26;font-weight:bold;text-decoration:none;padding:12px 26px;border-radius:4px;font-size:16px">Sign in</a></td></tr>
<tr><td style="padding:22px 0 0;font-size:13px;line-height:1.5;color:#a99bc4">The link works once and runs out in ${minutes} minutes. Didn't ask for this? Ignore this email; nobody gets in without the link.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: gameName ? `Sign in to ${gameName}` : 'Sign in to MBP Games', text, html };
}

export async function sendSignInEmail(env, to, msg) {
  if (!env.EMAIL) { console.log(`[mbp-games] no EMAIL binding; sign-in mail for ${to}:\n${msg.text}`); return; }
  await env.EMAIL.send({ to, from: { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME || 'MBP Games' }, subject: msg.subject, text: msg.text, html: msg.html });
}
