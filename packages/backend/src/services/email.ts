import nodemailer from 'nodemailer';
import { config } from '../config.js';

interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    contentType?: string;
  }>;
}

export function hasSmtpConfig(): boolean {
  return Boolean(config.email.smtpHost && config.email.smtpUser && config.email.smtpPass);
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  if (!hasSmtpConfig()) {
    if (config.isProd) {
      throw new Error('SMTP non configuré en production');
    }
    console.info(`[email:dev] To: ${input.to}\nSubject: ${input.subject}\n${input.text}`);
    return;
  }

  const transport = nodemailer.createTransport({
    host: config.email.smtpHost,
    port: config.email.smtpPort,
    secure: config.email.smtpSecure,
    auth: {
      user: config.email.smtpUser,
      pass: config.email.smtpPass,
    },
  });

  await transport.sendMail({
    from: config.email.from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    attachments: input.attachments,
  });
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  await sendEmail({
    to,
    subject: 'Réinitialisation de votre mot de passe Orbis',
    text: [
      'Une demande de réinitialisation de mot de passe a été initiée pour votre compte Orbis.',
      '',
      `Ouvrez ce lien pour choisir un nouveau mot de passe : ${resetUrl}`,
      '',
      `Ce lien expire dans ${config.email.resetTokenTtlMinutes} minutes.`,
      'Si vous n’êtes pas à l’origine de cette demande, ignorez cet email.',
    ].join('\n'),
    html: `
      <p>Une demande de réinitialisation de mot de passe a été initiée pour votre compte Orbis.</p>
      <p><a href="${resetUrl}">Choisir un nouveau mot de passe</a></p>
      <p>Ce lien expire dans ${config.email.resetTokenTtlMinutes} minutes.</p>
      <p>Si vous n’êtes pas à l’origine de cette demande, ignorez cet email.</p>
    `,
  });
}
