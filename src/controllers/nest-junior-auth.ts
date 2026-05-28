import { Request, Response } from 'express';
import { prisma } from '../lib/db/prisma';
import { nestBot, phoneToChatIdStore } from '../lib/notifications/nestJuniorBot';


// Simple in-memory store for OTPs (For production, consider Redis)
const otpStore = new Map<string, { code: string, expiry: number }>();

export const checkUser = async (req: Request, res: Response) => {
    try {
        const { firebaseUid } = req.body;
        // UPDATED: Now queries the isolated NestUser table
        const user = await prisma.nestUser.findUnique({ where: { firebaseUid } });
        res.json({ exists: !!user, user });
    } catch (error) {
        console.error("Check user error:", error);
        res.status(500).json({ error: "Database error" });
    }
};



export const sendTelegramOtp = async (req: Request, res: Response) => {
    const { phone, name } = req.body;
    
    // Clean user phone string input to match store format
    const cleanPhone = phone.replace(/\D/g, '');

    // 1. Generate 6-digit OTP
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(cleanPhone, { code, expiry: Date.now() + 10 * 60 * 1000 }); 

    try {
        // 2. Look up the secure chat ID mapping
        const targetChatId = phoneToChatIdStore.get(cleanPhone);

        if (!targetChatId || !nestBot) {
            return res.status(404).json({ 
                error: 'Telegram conversation not initialized. Please click the bot link and share your contact first.' 
            });
        }

        // 3. Fire the live 100ms/NestJunior notification wire
        await nestBot.sendMessage(
            targetChatId, 
            `Hello ${name || 'Parent'}, your Nest Junior verification code is: *${code}*.\n\nThis code will expire in 10 minutes.`,
            { parse_mode: 'Markdown' }
        );
        
        res.status(200).json({ success: true, message: 'OTP Sent securely via Telegram' });
    } catch (error) {
        console.error("Telegram Transmission Error:", error);
        res.status(500).json({ error: 'Failed to transmit OTP via Telegram bot engine' });
    }
};

export const verifyTelegramOtpAndRegister = async (req: Request, res: Response) => {
    const { firebaseUid, name, phone, otp } = req.body;

    const stored = otpStore.get(phone);
    if (!stored || stored.code !== otp || Date.now() > stored.expiry) {
        return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    try {
        // UPDATED: Now creates the record in the isolated NestUser table
        const user = await prisma.nestUser.create({
            data: {
                firebaseUid,
                name,
                phone,
                role: 'PARENT' 
            }
        });

        otpStore.delete(phone); 
        res.status(200).json({ success: true, user });
    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({ error: 'Failed to register user' });
    }
};