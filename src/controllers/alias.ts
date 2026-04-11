import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { prisma } from '../lib/db/prisma';
import { hashIdentifier } from '../lib/hashing';
import { normalizeIdentifier } from '../lib/security/normalization';
import { encryptData } from '../lib/encryption';

/**
 * STEP 1: Request OTP (100% Telegram Bot Flow)
 */
export const requestAliasOtp = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const { identifier, type } = req.body;

    if (!identifier || !type || type === 'instagram') {
      res.status(400).json({ error: 'Invalid request. Instagram skips OTP.' });
      return;
    }

    const normalizedIdentifier = normalizeIdentifier(type, identifier);

    // 1. Slot Check
    const wallet = await prisma.wallet.findUnique({ where: { user_id: userId } });
    if (!wallet || wallet.slots_balance < 2) {
      res.status(402).json({ error: 'Insufficient slots. Need 2 slots to add an alias.' });
      return;
    }

    // 2. Collision Check
    const hashedValue = hashIdentifier(type, normalizedIdentifier);
    const existing = await prisma.alias.findFirst({ where: { hashed_value: hashedValue, verified: true } });
    if (existing) {
      res.status(409).json({ error: 'This contact is already verified by someone else.' });
      return;
    }

    // 3. Generate & Save OTP (Using 'phone' column as a generic identifier field)
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.otpRequest.upsert({
      where: { phone: normalizedIdentifier }, 
      update: { otp_code: otpCode, expires_at: expiresAt },
      create: { phone: normalizedIdentifier, otp_code: otpCode, expires_at: expiresAt }
    });

    // 4. Send them to the Bot! (No SMS provider needed)
    res.status(200).json({ 
      success: true, 
      botUrl: 'https://t.me/ZabiyaConciergeBot?start=alias' 
    });

  } catch (error: any) {
    console.error('[Alias OTP Error]', error);
    res.status(500).json({ error: 'Failed to request OTP.' });
  }
};

/**
 * STEP 2: Verify OTP & Deduct Slots
 */
export const verifyAndAddAlias = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const { identifier, type, otp } = req.body;
    const normalizedIdentifier = normalizeIdentifier(type, identifier);

    if (type !== 'instagram') {
      if (!otp) return void res.status(400).json({ error: 'OTP required.' });
      
      const otpRecord = await prisma.otpRequest.findUnique({ where: { phone: normalizedIdentifier } });
      if (!otpRecord || otpRecord.otp_code !== otp || otpRecord.expires_at < new Date()) {
        res.status(401).json({ error: 'Invalid or expired OTP.' });
        return;
      }
    }

    const hashedValue = hashIdentifier(type, normalizedIdentifier);
    const encryptedValue = encryptData(normalizedIdentifier); // 👈 Generate the locked string

    await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { user_id: userId } });
      if (!wallet || wallet.slots_balance < 2) throw new Error('Insufficient slots.');

      await tx.wallet.update({
        where: { user_id: userId },
        data: { slots_balance: { decrement: 2 } }
      });

      await tx.alias.create({
        data: {
          user_id: userId,
          type: type,
          hashed_value: hashedValue,
          encrypted_value: encryptedValue,
          verified: true,
          verification_method: type === 'instagram' ? 'self_attest' : 'telegram_bot_bridge'
        }
      });

      if (type !== 'instagram') await tx.otpRequest.delete({ where: { phone: normalizedIdentifier } });
    });

    // 🚀 CRITICAL: Instant Match Check
    const inboundIntents = await prisma.intent.findMany({ 
      where: { target_hash: hashedValue, status: 'ACTIVE' } // or 'ACTIVE' 
    });
    res.json({ success: true, newMatchFound: inboundIntents.length > 0 });
    
  } catch (error: any) {
    res.status(error.message === 'Insufficient slots.' ? 402 : 500).json({ error: error.message || 'Failed.' });
  }
};

/**
 * STEP 3: "Quick Activate" (Upsell)
 */
export const quickActivateTelegram = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const { telegramUsername } = req.body;
    if (!telegramUsername) return void res.status(400).json({ error: 'Username required.' });

    // 1. Create BOTH the one-way hash (for matching) and the two-way lock (for UI)
    const hashedTelegram = hashIdentifier('telegram', telegramUsername);
    const encryptedTelegram = encryptData(telegramUsername); // 👈 GENERATE IT HERE

    await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { user_id: userId } });
      if (!wallet || wallet.slots_balance < 2) throw new Error('Insufficient slots.');

      await tx.wallet.update({ where: { user_id: userId }, data: { slots_balance: { decrement: 2 } } });

      await tx.alias.create({
        data: {
          user_id: userId, 
          type: 'telegram', 
          hashed_value: hashedTelegram,
          encrypted_value: encryptedTelegram, // 👈 ADD IT HERE TO SAVE IN DB
          verified: true, 
          verification_method: 'telegram_auth_extracted'
        }
      });
    });

    const inboundIntents = await prisma.intent.findMany({ where: { target_hash: hashedTelegram, status: 'active' } });
    res.json({ success: true, newMatchFound: inboundIntents.length > 0 });
  } catch (error: any) {
    res.status(error.message === 'Insufficient slots.' ? 402 : 500).json({ error: error.message || 'Failed.' });
  }
};