/**
 * Email Service
 * Sends OTP emails using Gmail SMTP
 */
import * as nodemailer from "nodemailer";
import * as path from "path";
import * as dotenv from "dotenv";
import { app } from "electron";

// Load environment variables
// In development, load from project root
// In production, load from app resources
const envPath = app.isPackaged
  ? path.join(process.resourcesPath, ".env")
  : path.join(__dirname, "../../.env");

dotenv.config({ path: envPath });

// Create transporter
let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.GMAIL_HOST || "smtp.gmail.com",
      port: parseInt(process.env.GMAIL_PORT || "465"),
      secure: true, // true for 465, false for other ports
      auth: {
        user: process.env.GMAIL_APP_USERNAME,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
  }
  return transporter;
}

/**
 * Send OTP verification email
 */
export async function sendOTPEmail(
  to: string,
  otp: string,
  userName?: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const transport = getTransporter();
    const fromName = process.env.EMAIL_FROM_NAME || "De-Droid";
    const fromEmail = process.env.EMAIL_FROM || process.env.GMAIL_APP_USERNAME;

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #1a1a2e;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <tr>
      <td style="text-align: center; padding-bottom: 30px;">
        <div style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 15px 25px; border-radius: 12px;">
          <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">📱 De-Droid</h1>
        </div>
      </td>
    </tr>
    <tr>
      <td style="background-color: #16213e; border-radius: 16px; padding: 40px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
        <h2 style="color: #ffffff; margin: 0 0 20px 0; font-size: 24px; text-align: center;">
          ${userName ? `Hey ${userName}! 👋` : "Hey there! 👋"}
        </h2>
        <p style="color: #a0aec0; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0; text-align: center;">
          Use the verification code below to complete your sign-in to De-Droid.
        </p>
        
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; padding: 25px; text-align: center; margin-bottom: 30px;">
          <p style="color: rgba(255,255,255,0.8); font-size: 14px; margin: 0 0 10px 0; text-transform: uppercase; letter-spacing: 2px;">
            Your Verification Code
          </p>
          <div style="font-size: 42px; font-weight: 700; color: #ffffff; letter-spacing: 8px; font-family: 'Courier New', monospace;">
            ${otp}
          </div>
        </div>
        
        <p style="color: #718096; font-size: 14px; text-align: center; margin: 0 0 20px 0;">
          ⏱️ This code expires in <strong style="color: #e53e3e;">10 minutes</strong>
        </p>
        
        <div style="border-top: 1px solid #2d3748; padding-top: 25px; margin-top: 25px;">
          <p style="color: #718096; font-size: 13px; text-align: center; margin: 0;">
            If you didn't request this code, you can safely ignore this email.
            <br>Someone might have typed your email by mistake.
          </p>
        </div>
      </td>
    </tr>
    <tr>
      <td style="text-align: center; padding-top: 30px;">
        <p style="color: #4a5568; font-size: 12px; margin: 0;">
          De-Droid - Android Debloater
          <br>
          <span style="color: #718096;">Made with ❤️ for a cleaner Android experience</span>
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    const textContent = `
De-Droid - Email Verification

${userName ? `Hey ${userName}!` : "Hey there!"}

Your verification code is: ${otp}

This code expires in 10 minutes.

If you didn't request this code, you can safely ignore this email.

---
De-Droid - Android Debloater
    `;

    const info = await transport.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: to,
      subject: `🔐 Your De-Droid Verification Code: ${otp}`,
      text: textContent,
      html: htmlContent,
    });

    console.log("[EMAIL] OTP sent successfully:", info.messageId);
    return { success: true, message: "Verification code sent to your email" };
  } catch (error) {
    console.error("[EMAIL] Failed to send OTP:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to send email",
    };
  }
}

/**
 * Verify the transporter connection
 */
export async function verifyEmailConnection(): Promise<boolean> {
  try {
    const transport = getTransporter();
    await transport.verify();
    console.log("[EMAIL] SMTP connection verified");
    return true;
  } catch (error) {
    console.error("[EMAIL] SMTP connection failed:", error);
    return false;
  }
}
