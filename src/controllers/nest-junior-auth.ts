import { Request, Response } from 'express';
import { prisma } from '../lib/db/prisma';

// Simple in-memory store for OTPs (For production, consider Redis)
const otpStore = new Map<string, { code: string, expiry: number }>();

export const checkUser = async (req: Request, res: Response) => {
    try {
        const { firebaseUid } = req.body;
        const user = await prisma.user.findUnique({ where: { firebaseUid } });
        res.json({ exists: !!user, user });
    } catch (error) {
        console.error("Check user error:", error);
        res.status(500).json({ error: "Database error" });
    }
};

export const sendTelegramOtp = async (req: Request, res: Response) => {
    const { phone, name } = req.body;
    
    // Generate a 6-digit OTP
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(phone, { code, expiry: Date.now() + 10 * 60 * 1000 }); // 10 min expiry

    try {
        // NOTE: In production, you must look up the user's Telegram chat_id 
        // using their phone number from your database before sending the message.
        // For now, we log it to the console so you can test the frontend flow!
        console.log(`\n\n=== DEV LOG ===\nOTP for ${name} (${phone}) is: ${code}\n===============\n`);
        
        res.status(200).json({ success: true, message: 'OTP Sent' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to send OTP' });
    }
};

export const verifyTelegramOtpAndRegister = async (req: Request, res: Response) => {
    const { firebaseUid, name, phone, otp } = req.body;

    // 1. Verify the OTP
    const stored = otpStore.get(phone);
    if (!stored || stored.code !== otp || Date.now() > stored.expiry) {
        return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    try {
        // 2. Create the User in Prisma as a PARENT
        const user = await prisma.user.create({
            data: {
                firebaseUid,
                name,
                phone,
                role: 'PARENT' // Explicitly setting the role based on your schema
            }
        });

        otpStore.delete(phone); // Clear the OTP
        res.status(200).json({ success: true, user });
    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({ error: 'Failed to register user' });
    }
};