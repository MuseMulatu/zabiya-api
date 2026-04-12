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
          data: { 
            user_id: dbUser.id, 
            slots_balance: 2 // 👈 Unified currency
          }
        });

// Register Verified Alias
        await tx.alias.create({
          data: {
            user_id: dbUser.id,
            type: 'phone',
            hashed_value: hashedPhone,
            encrypted_value: encryptedPhone, // 👈 ADD THIS LINE TO FIX "HIDDEN"
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
// A1. Handle Main Login (/start auth)
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

    // A2. Handle Alias Addition (/start alias)
    if (message.text && message.text === '/start alias') {
      const altUsername = message.from.username;
      let otpFound = false;

      // 1. Check if they are verifying a Telegram Username
      if (altUsername) {
        const normalizedUsername = normalizeIdentifier('telegram', altUsername);
        const pendingOtp = await prisma.otpRequest.findUnique({ where: { phone: normalizedUsername } });
        
        if (pendingOtp && pendingOtp.expires_at > new Date()) {
          await sendTelegramWithKeyboard(chatId, `🔐 Your Alias Verification Code is:  \`${pendingOtp.otp_code}\`\n\nType this back into the Zabiya website to link this account.`);
          otpFound = true;
        }
      }
      // 2. If no username OTP was found, assume they are verifying a Phone Number!
      if (!otpFound) {
        const keyboard = {
          keyboard: [[{ text: "📱 Share Contact to Verify Alias", request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true
        };
        await sendTelegramWithKeyboard(chatId, "If you are verifying a Phone Number alias, please tap the button below to share your contact.\n\nIf you are verifying a Telegram handle, we couldn't find a request for your username. Ensure you typed it correctly on the website.", keyboard);
      }
      
      res.status(200).send('OK');
      return;
    }

// B. Handle Contact Sharing (Catches BOTH Login and Alias phone numbers!)
    if (message.contact) {
      if (message.contact.user_id !== message.from.id) {
        await sendTelegramWithKeyboard(chatId, "⚠️ You can only share your own contact card for security reasons.");
        res.status(200).send('OK');
        return;
      }

      const normalizedPhone = normalizeIdentifier('phone', message.contact.phone_number);
      const username = message.from.username;

      // 🚨 1. ENCRYPT EVERYTHING
      const encryptedPhone = encryptData(normalizedPhone);
      const encryptedUsername = username ? encryptData(username) : null;
      const hashedPhone = hashIdentifier('phone', normalizedPhone);
      const hashedTelegram = username ? hashIdentifier('telegram', username) : null;

      // 🚨 2. BUILD THE USER PROFILE RIGHT NOW (While we have the TG data!)
      const dbUser = await prisma.$transaction(async (tx) => {
        let user = await tx.user.findUnique({ where: { telegram_chat_id: chatId.toString() } });

        if (!user) {
          // New User!
          user = await tx.user.create({
            data: {
              telegram_chat_id: chatId.toString(),
              phone_encrypted: encryptedPhone,
              telegram_username_enc: encryptedUsername
            }
          });
          await tx.wallet.create({ data: { user_id: user.id, slots_balance: 2 } });
        } else {
          // Returning User, update their data just in case it changed
          user = await tx.user.update({
            where: { id: user.id },
            data: { phone_encrypted: encryptedPhone, telegram_username_enc: encryptedUsername }
          });
        }

        // Always ensure their Phone Alias is perfectly synced
        await tx.alias.upsert({
          where: { user_id_type_hashed_value: { user_id: user.id, type: 'phone', hashed_value: hashedPhone } },
          update: { verified: true, encrypted_value: encryptedPhone },
          create: {
            user_id: user.id, type: 'phone', hashed_value: hashedPhone,
            encrypted_value: encryptedPhone, verified: true, verification_method: 'telegram_contact_share'
          }
        });

        // Upsert Telegram Alias IF they verified it explicitly, otherwise leave it for the Upsell!
        // (We don't create it automatically here anymore so the Dashboard upsell triggers)
        
        return user;
      });

      // 🚨 3. HAND THEM THE OTP
      const pendingOtp = await prisma.otpRequest.findUnique({ where: { phone: normalizedPhone } });
      
      if (pendingOtp && pendingOtp.expires_at > new Date()) {
        await sendTelegramWithKeyboard(chatId, `🔒 Your Zabiya Code is: \`${pendingOtp.otp_code}\`\n\nReturn to the web app and enter this code.`);
      } else {
        await sendTelegramWithKeyboard(chatId, "You don't have an active request. Please request a code from the web app first.");
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
export const handleTelegramAuth = async (req: Request, res: Response): Promise<void> => {
  try {
    const secretToken = req.headers['x-telegram-bot-api-secret-token'];
    
    if (secretToken !== process.env.TELEGRAM_BOT_TOKEN) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { message } = req.body;

    if (!message || !message.contact || !message.from || !message.chat) {
      res.status(400).json({ error: 'Invalid payload structure.' });
      return;
    }

    // 🚨 LOG 1: RAW EXTRACTION
    console.log("\n=== 🕵️‍♂️ X-RAY 1: RAW TELEGRAM DATA ===");
    console.log("Raw Phone:", message.contact.phone_number);
    console.log("Raw Username from 'message.from':", message.from.username);
    console.log("Raw Username from 'message.chat':", message.chat.username);
    console.log("=======================================\n");

    const phone_number = message.contact.phone_number;
    const chat_id = message.chat.id.toString();
    // Fallback: Check both .from and .chat just in case Telegram formats it weirdly
    const username = message.from?.username || message.chat?.username || null; 

    // Cryptographic Processing
    const encryptedPhone = encryptData(phone_number);
    const encryptedUsername = username ? encryptData(username) : null; 
    const hashedPhone = hashIdentifier('phone', phone_number);
    const hashedTelegram = username ? hashIdentifier('telegram', username) : null;

    // 🚨 LOG 2: ENCRYPTION CHECK
    console.log("\n=== 🕵️‍♂️ X-RAY 2: ENCRYPTION RESULTS ===");
    console.log("Did phone encrypt?", !!encryptedPhone);
    console.log("Did username encrypt?", !!encryptedUsername, "| Value:", encryptedUsername ? "SUCCESS" : "NULL");
    console.log("=======================================\n");

    // Database Transaction
    const user = await prisma.$transaction(async (tx) => {
      let dbUser = await tx.user.findUnique({ where: { telegram_chat_id: chat_id } });

      // 🚨 LOG 3: DATABASE SAVE PREP
      console.log(`\n=== 🕵️‍♂️ X-RAY 3: DB USER SAVE ===`);
      console.log(`Saving Username Encrypted as:`, encryptedUsername);

      if (!dbUser) {
        dbUser = await tx.user.create({
          data: {
            telegram_chat_id: chat_id,
            phone_encrypted: encryptedPhone,
            telegram_username_enc: encryptedUsername
          }
        });
        await tx.wallet.create({ data: { user_id: dbUser.id, slots_balance: 2 } });
      } else {
        dbUser = await tx.user.update({
          where: { id: dbUser.id },
          data: { 
            phone_encrypted: encryptedPhone, 
            telegram_username_enc: encryptedUsername, 
            updated_at: new Date() 
          }
        });
      }

      const aliasesToUpsert = [
        { 
          type: 'phone', 
          hashed_value: hashedPhone, 
          encrypted_value: encryptedPhone,
          verification_method: 'telegram_contact_share' 
        }
      ];

      if (hashedTelegram && encryptedUsername) {
        aliasesToUpsert.push({ 
          type: 'telegram', 
          hashed_value: hashedTelegram, 
          encrypted_value: encryptedUsername, 
          verification_method: 'telegram_auth' 
        });
      }

      // 🚨 LOG 4: ALIAS SAVE PREP
      console.log(`\n=== 🕵️‍♂️ X-RAY 4: DB ALIAS SAVE ===`);
      console.log(`Aliases queued for saving:`, aliasesToUpsert.map(a => `${a.type} -> Encrypted: ${!!a.encrypted_value}`));

      for (const alias of aliasesToUpsert) {
        await tx.alias.upsert({
          where: {
            user_id_type_hashed_value: { user_id: dbUser.id, type: alias.type, hashed_value: alias.hashed_value }
          },
          update: { 
            verified: true,
            encrypted_value: alias.encrypted_value 
          },
          create: {
            user_id: dbUser.id,
            type: alias.type,
            hashed_value: alias.hashed_value,
            encrypted_value: alias.encrypted_value,
            verified: true,
            verification_method: alias.verification_method
          }
        });
      }

      return dbUser;
    });

    console.log("\n=== ✅ X-RAY COMPLETE: TRANSACTION SUCCESS ===\n");

    const token = jwt.sign({ userId: user.id, chatId: user.telegram_chat_id }, process.env.JWT_SECRET as string, { expiresIn: '30d' });

    res.status(200).json({
      success: true,
      token,
      user: { id: user.id, requires_demographics: !user.gender || !user.birth_date }
    });

  } catch (error) {
    console.error('\n❌ [Auth Error X-RAY]:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};