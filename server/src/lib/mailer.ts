import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { logger } from './logger.js';

const transport = config.mail.smtpUrl ? nodemailer.createTransport(config.mail.smtpUrl) : null;

export async function sendMail(to: string, subject: string, text: string) {
  if (!transport) {
    // Without SMTP configured (local development) the message is written to the log instead.
    logger.warn({ to, subject }, `[mail:not-configured]\n${text}`);
    return;
  }
  await transport.sendMail({ from: config.mail.from, to, subject, text });
}
