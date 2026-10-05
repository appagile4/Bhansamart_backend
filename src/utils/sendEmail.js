import transporter from "../config/mail.js";

/**
 * Generic email sender function
 */
export const sendEmail = async ({ to, subject, html, text }) => {
  const mailOptions = {
    from: process.env.SMTP_FROM || `"BhansaMart" <no-reply@bhansamart.com>`,
    to,
    subject,
    text: text || html.replace(/<[^>]*>?/gm, ""), // fallback plain text
    html,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(
      `[Email Service] Email sent successfully to ${to} (MessageID: ${info.messageId})`,
    );
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(
      `[Email Service Error] Failed to send email to ${to}:`,
      error.message,
    );
    // In development mode, log OTP to console so testing is seamless even without live SMTP
    if (process.env.NODE_ENV === "development") {
      console.warn(
        `[Dev Warning] Email was not dispatched via SMTP. If you're testing locally, check your .env SMTP credentials or console logs.`,
      );
    }
    // We do not crash the app, but return failure object
    return { success: false, error: error.message };
  }
};

/**
 * Send Email Verification OTP
 */
export const sendVerificationOTP = async (email, otp) => {
  console.log(`[DEV OTP] Verification OTP for ${email}: ${otp}`);
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verify Your Email - BhansaMart</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f7f6; margin: 0; padding: 20px; }
          .container { max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.06); }
          .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; text-align: center; color: #ffffff; }
          .header h1 { margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.5px; }
          .content { padding: 35px 30px; color: #334155; line-height: 1.6; }
          .greeting { font-size: 18px; font-weight: 600; margin-bottom: 12px; color: #0f172a; }
          .otp-card { background: #f8fafc; border: 2px dashed #10b981; border-radius: 10px; padding: 20px; text-align: center; margin: 25px 0; }
          .otp-code { font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #059669; font-family: 'Courier New', Courier, monospace; }
          .otp-validity { font-size: 13px; color: #64748b; margin-top: 8px; }
          .footer { background: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>BhansaMart</h1>
          </div>
          <div class="content">
            <div class="greeting">Welcome to BhansaMart!</div>
            <p>Thank you for creating an account with us. To complete your registration and verify your email address, please use the 6-digit verification code below:</p>
            
            <div class="otp-card">
              <div class="otp-code">${otp}</div>
              <div class="otp-validity">This code is valid for 10 minutes.</div>
            </div>

            <p>If you did not request this account registration, you can safely ignore this email.</p>
          </div>
          <div class="footer">
            &copy; ${new Date().getFullYear()} BhansaMart. All rights reserved.<br>
            Secure Food & Grocery Shopping.
          </div>
        </div>
      </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: `BhansaMart - Your Verification Code is ${otp}`,
    html,
  });
};

/**
 * Send Password Reset OTP
 */
export const sendPasswordResetOTP = async (email, otp) => {
  console.log(`[DEV OTP] Password Reset OTP for ${email}: ${otp}`);

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reset Your Password - BhansaMart</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f7f6; margin: 0; padding: 20px; }
          .container { max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.06); }
          .header { background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); padding: 30px; text-align: center; color: #ffffff; }
          .header h1 { margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.5px; }
          .content { padding: 35px 30px; color: #334155; line-height: 1.6; }
          .greeting { font-size: 18px; font-weight: 600; margin-bottom: 12px; color: #0f172a; }
          .otp-card { background: #fef2f2; border: 2px dashed #ef4444; border-radius: 10px; padding: 20px; text-align: center; margin: 25px 0; }
          .otp-code { font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #dc2626; font-family: 'Courier New', Courier, monospace; }
          .otp-validity { font-size: 13px; color: #991b1b; margin-top: 8px; }
          .footer { background: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>BhansaMart Security</h1>
          </div>
          <div class="content">
            <div class="greeting">Password Reset Request</div>
            <p>We received a request to reset your password for your BhansaMart account. Enter the verification code below in your app to continue:</p>
            
            <div class="otp-card">
              <div class="otp-code">${otp}</div>
              <div class="otp-validity">This OTP is valid for 10 minutes.</div>
            </div>

            <p>If you did not request a password reset, please secure your account immediately or disregard this email.</p>
          </div>
          <div class="footer">
            &copy; ${new Date().getFullYear()} BhansaMart. All rights reserved.<br>
            Security & Authentication Team.
          </div>
        </div>
      </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: `BhansaMart - Password Reset Code: ${otp}`,
    html,
  });
};

/**
 * Send Password Changed Confirmation Email
 */
export const sendPasswordChangedEmail = async (email) => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Changed - BhansaMart</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f7f6; margin: 0; padding: 20px; }
          .container { max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.06); }
          .header { background: #0f172a; padding: 30px; text-align: center; color: #ffffff; }
          .header h1 { margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.5px; }
          .content { padding: 35px 30px; color: #334155; line-height: 1.6; }
          .greeting { font-size: 18px; font-weight: 600; margin-bottom: 12px; color: #0f172a; }
          .alert-box { background: #ecfdf5; border-left: 4px solid #10b981; padding: 15px; border-radius: 4px; margin: 20px 0; color: #065f46; font-size: 14px; }
          .footer { background: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>BhansaMart</h1>
          </div>
          <div class="content">
            <div class="greeting">Security Alert: Password Updated</div>
            <div class="alert-box">
              Your BhansaMart account password was successfully changed on ${new Date().toUTCString()}.
            </div>
            <p>If you performed this action, no further steps are needed.</p>
            <p>If you did <strong>NOT</strong> change your password, please contact our support team immediately to secure your account.</p>
          </div>
          <div class="footer">
            &copy; ${new Date().getFullYear()} BhansaMart. All rights reserved.<br>
            Customer Support & Security.
          </div>
        </div>
      </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: `BhansaMart - Your password was updated successfully`,
    html,
  });
};
