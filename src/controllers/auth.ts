import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/db/prisma';
import { encryptData } from '../lib/encryption';
import { hashIdentifier } from '../lib/hashing';
import { AuthenticatedRequest } from '../middleware/auth';
import { normalizeIdentifier } from '../lib/security/normalization';

const JWT_SECRET = process.env.JWT_SECRET as string;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!JWT_SECRET || !TELEGRAM_BOT_TOKEN) {
  throw new Error('CRITICAL: Missing JWT_SECRET or TELEGRAM_BOT_TOKEN.');
}

// Helper: Normalize phone numbers to E.164
const normalizePhone = (phone: string): string => {
  const cleaned = phone.replace(/[^\d+]/g, '');
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
};
const normalizedPhone = normalizeIdentifier('phone', phone); // Or message.contact.phone_number

// Helper: Send Telegram Message with optional Keyboard
const sendTelegramWithKeyboard = async (chatId: string | number, text: string, keyboard?: any) => {
  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        reply_markup: keyboard ? keyboard : { remove_keyboard: true }
      })
    });
    
    const data = await response.json();
    if (!response.ok) {
      console.error('🚨 [Telegram API Error]:', data);
    }
  } catch (err) {
    console.error('🚨 [Fetch Error]:', err);
  }
};

/**
 * 1. POST /api/auth/request-otp
 * Generates an OTP and temporarily stores it.
 */
export const requestOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const { phone } = req.body;
    if (!phone) {
      res.status(400).json({ error: 'Phone number is required.' });
      return;
    }

    const normalizedPhone = normalizeIdentifier('phone', phone); // Or message.contact.phone_number
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

    await prisma.otpRequest.upsert({
      where: { phone: normalizedPhone },
      update: { otp_code: otpCode, expires_at: expiresAt },
      create: { phone: normalizedPhone, otp_code: otpCode, expires_at: expiresAt }
    });

    res.status(200).json({ 
      success: true, 
      botUrl: 'https://t.me/ZabiyaConciergeBot?start=auth' 
    });
  } catch (error) {
    console.error('[Request OTP Error]', error);
    res.status(500).json({ error: 'Failed to request OTP.' });
  }
};

/**
 * 2. POST /api/auth/verify-otp
 * Validates the OTP, provisions the User and Wallet if new, and issues JWT.
 */
export const verifyOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) {
      res.status(400).json({ error: 'Phone and OTP are required.' });
      return;
    }

    const normalizedPhone = normalizeIdentifier('phone', phone); // Or message.contact.phone_number

    // 1. Validate OTP
    const otpRecord = await prisma.otpRequest.findUnique({ where: { phone: normalizedPhone } });
    if (!otpRecord || otpRecord.otp_code !== otp || otpRecord.expires_at < new Date()) {
      res.status(401).json({ error: 'Invalid or expired OTP.' });
      return;
    }

    // 2. Cryptographic processing
    const hashedPhone = hashIdentifier('phone', normalizedPhone);
    const encryptedPhone = encryptData(normalizedPhone);

    // 3. Atomic User Provisioning
    const user = await prisma.$transaction(async (tx) => {
      // Find existing user via their verified phone alias
      const existingAlias = await tx.alias.findFirst({
        where: { hashed_value: hashedPhone, verified: true },
        include: { user: true }
      });

      let dbUser;
      if (existingAlias) {
        dbUser = existingAlias.user;
      } else {
        // Create new User & Wallet
        dbUser = await tx.user.create({
          data: { phone_encrypted: encryptedPhone }
        });

        await tx.wallet.create({
          data: { user_id: dbUser.id, intent_slots_balance: 2, alias_slots_balance: 0 }
        });

        // Register Verified Alias
        await tx.alias.create({
          data: {
            user_id: dbUser.id,
            type: 'phone',
            hashed_value: hashedPhone,
            verified: true,
            verification_method: 'telegram_otp_bridge'
          }
        });
      }
      return dbUser;
    });

    // 4. Cleanup OTP & Issue JWT
    await prisma.otpRequest.delete({ where: { phone: normalizedPhone } });

    const token = jwt.sign(
      { userId: user.id, chatId: user.telegram_chat_id || '' }, 
      JWT_SECRET, 
      { expiresIn: '7d' }
    );

    res.status(200).json({
      success: true,
      token,
      user: { id: user.id, requires_demographics: !user.gender || !user.birth_date }
    });

  } catch (error) {
    console.error('[Verify OTP Error]', error);
    res.status(500).json({ error: 'Failed to verify OTP.' });
  }
};

/**
 * 3. POST /api/auth/telegram/webhook
 * Handles Telegram Bot interactions for OTP delivery and Contact Sharing.
 */
export const handleTelegramWebhook = async (req: Request, res: Response): Promise<void> => {
  console.log('🤖 [Webhook Received]:', JSON.stringify(req.body, null, 2)); // Add this line!
  try {
    // 🚨 Note: Secure this endpoint with the secret token header in production middleware
    const { message } = req.body;
    if (!message) {
  res.status(200).send('OK');
  return;
}

    const chatId = message.chat.id;

    // A. Handle /start command
    if (message.text && (message.text === '/start auth' || message.text === '/start')) {
      const keyboard = {
        keyboard: [[{ text: "📱 Share Contact to Login", request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true
      };
      await sendTelegramWithKeyboard(chatId, "Welcome to Zabiya Orbit. Please share your contact to securely log in.", keyboard);
      res.status(200).send('OK');
return;
    }

    // B. Handle Contact Sharing
    if (message.contact) {
      // Validate contact ownership (Anti-spoofing)
      if (message.contact.user_id !== message.from.id) {
        await sendTelegramWithKeyboard(chatId, "⚠️ You can only share your own contact card for security reasons.");
        res.status(200).send('OK');
        return;
      }

      const normalizedPhone = normalizeIdentifier('phone', message.contact.phone_number); // Or message.contact.phone_number
      const username = message.from.username;

      // Check for pending OTP
      const pendingOtp = await prisma.otpRequest.findUnique({ where: { phone: normalizedPhone } });
      
      if (pendingOtp && pendingOtp.expires_at > new Date()) {
        await sendTelegramWithKeyboard(chatId, `🔒 Your Zabiya Login Code is: *${pendingOtp.otp_code}*\n\nReturn to the web app and enter this code.`);
      } else {
        await sendTelegramWithKeyboard(chatId, "You don't have an active login request. Please request a code from the web app first.");
      }

      // Upsert Chat ID & Username asynchronously so we have it for matches
      const hashedPhone = hashIdentifier('phone', normalizedPhone);
      const existingAlias = await prisma.alias.findFirst({ where: { hashed_value: hashedPhone, verified: true } });
      
      if (existingAlias) {
        await prisma.user.update({
          where: { id: existingAlias.user_id },
          data: { telegram_chat_id: chatId.toString() } // Store chat ID for Match Notifications
        });
        
        if (username) {
          const hashedTelegram = hashIdentifier('telegram', username);
          await prisma.alias.upsert({
            where: { user_id_type_hashed_value: { user_id: existingAlias.user_id, type: 'telegram', hashed_value: hashedTelegram } },
            update: { verified: true },
            create: { user_id: existingAlias.user_id, type: 'telegram', hashed_value: hashedTelegram, verified: true, verification_method: 'telegram_auth' }
          });
        }
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('[Telegram Webhook Error]', error);
    res.status(500).send('Error');
  }
};

/**
 * Demographics Endpoint
 * Now strictly secured against IDOR. Extracts identity ONLY from the JWT middleware.
 */
export const updateDemographics = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    // IDOR Prevented: Read exclusively from our trusted JWT payload attached by middleware
    const userId = req.user?.userId;
    
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized: User identity could not be established.' });
      return;
    }

    const { gender, birth_date } = req.body;

    if (!gender || !birth_date) {
      res.status(400).json({ error: 'Missing required demographic fields.' });
      return;
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        gender,
        birth_date: new Date(birth_date),
      }
    });

    res.status(200).json({
      success: true,
      message: 'Demographics updated successfully',
      user: {
        id: updatedUser.id,
        requires_demographics: false
      }
    });

  } catch (error) {
    console.error('[Demographics Error]', error);
    res.status(500).json({ error: 'Failed to update demographics.' });
  }
};

/**
 * Handles Telegram Webhook payload.
 * Verifies via X-Telegram-Bot-Api-Secret-Token header.
 */
export const handleTelegramAuth = async (req: Request, res: Response): Promise<void> => {
  try {
    // 1. Verify Webhook Authenticity (Header Validation)
    const secretToken = req.headers['x-telegram-bot-api-secret-token'];
    
    if (secretToken !== TELEGRAM_BOT_TOKEN) {
      res.status(401).json({ error: 'Unauthorized: Invalid Telegram Webhook Secret Token.' });
      return;
    }

    const { message } = req.body;

    if (!message || !message.contact || !message.from || !message.chat) {
      res.status(400).json({ error: 'Invalid payload structure.' });
      return;
    }

    // 2. Contact Ownership Validation
    if (message.contact.user_id !== message.from.id) {
      res.status(403).json({ error: 'Forbidden: Contact card does not belong to the authenticating user.' });
      return;
    }

    const phone_number = message.contact.phone_number;
    const chat_id = message.chat.id.toString();
    const username = message.from.username;

    // Cryptographic Processing
    const encryptedPhone = encryptData(phone_number);
    const hashedPhone = hashIdentifier('phone', phone_number);
    const hashedTelegram = username ? hashIdentifier('telegram', username) : null;

    // Database Transaction
    const user = await prisma.$transaction(async (tx) => {
      let dbUser = await tx.user.findUnique({ where: { telegram_chat_id: chat_id } });

      if (!dbUser) {
        // Create new user
        dbUser = await tx.user.create({
          data: {
            telegram_chat_id: chat_id,
            phone_encrypted: encryptedPhone,
          }
        });

        // 3. Slot Architecture Fix: Initialize Wallet
        await tx.wallet.create({
          data: {
            user_id: dbUser.id,
            intent_slots_balance: 2, // Grant 2 free intent slots
            alias_slots_balance: 0
          }
        });
      } else {
        // Update existing user
        dbUser = await tx.user.update({
          where: { id: dbUser.id },
          data: { phone_encrypted: encryptedPhone, updated_at: new Date() }
        });
      }

      // Prepare & Upsert Aliases
      const aliasesToUpsert = [
        { type: 'phone', hashed_value: hashedPhone, verification_method: 'telegram_contact_share' }
      ];

      if (hashedTelegram) {
        aliasesToUpsert.push({ type: 'telegram', hashed_value: hashedTelegram, verification_method: 'telegram_auth' });
      }

      for (const alias of aliasesToUpsert) {
        await tx.alias.upsert({
          where: {
            user_id_type_hashed_value: { user_id: dbUser.id, type: alias.type, hashed_value: alias.hashed_value }
          },
          update: { verified: true },
          create: {
            user_id: dbUser.id,
            type: alias.type,
            hashed_value: alias.hashed_value,
            verified: true,
            verification_method: alias.verification_method
          }
        });
      }

      return dbUser;
    });

    const token = jwt.sign({ userId: user.id, chatId: user.telegram_chat_id }, JWT_SECRET, { expiresIn: '30d' });

    res.status(200).json({
      success: true,
      token,
      user: {
        id: user.id,
        requires_demographics: !user.gender || !user.birth_date
      }
    });

  } catch (error) {
    console.error('[Auth Error]', error);
    // Be careful not to leak exact database collision errors to the client
    res.status(500).json({ error: 'Internal Server Error' });
  }
};