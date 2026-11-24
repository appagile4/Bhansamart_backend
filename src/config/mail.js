import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const createTransporter = () => {
  const isAuthProvided = process.env.SMTP_USER && process.env.SMTP_PASSWORD;

  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const host = process.env.SMTP_HOST || "smtp.gmail.com";

  const config = {
    host,
    port,
    secure: port === 465,
    auth: isAuthProvided
      ? {
          user: process.env.SMTP_USER.trim(),
          pass: process.env.SMTP_PASSWORD.trim().replace(/\s+/g, ""),
        }
      : undefined,
  };

  if (process.env.SMTP_SERVICE === "gmail" || host.includes("gmail")) {
    config.service = "gmail";
  }

  const transporter = nodemailer.createTransport(config);

  return transporter;
};

const transporter = createTransporter();

export default transporter;
