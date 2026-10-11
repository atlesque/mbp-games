-- Every sign-in email we tried to send, kept 90 days, so the admin page can show who asked for a link
-- but never opened it (pending registrations) and whether the email actually went out.
-- status: 'sent' (the mail service took it), 'failed' (it refused; error says why), 'logged' (no mail service, link only logged).
CREATE TABLE sign_in_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  at INTEGER NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  client TEXT
);
CREATE INDEX sign_in_emails_email ON sign_in_emails (email, at);
CREATE INDEX sign_in_emails_at ON sign_in_emails (at);

-- links still on file were sent: a failed send deletes its link
INSERT INTO sign_in_emails (email, at, status, client) SELECT email, created_at, 'sent', client FROM magic_links;
