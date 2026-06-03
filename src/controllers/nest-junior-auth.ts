import { Request, Response } from 'express';
import { prisma } from '../lib/db/prisma';
//import { nestBot, phoneToChatIdStore } from '../lib/notifications/nestJuniorBot';
import { normalizePhoneNumber } from '../lib/security/normalization';

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



// export const sendTelegramOtp = async (req: Request, res: Response) => {
//     const { phone, name } = req.body;
    
//     // Clean user phone string input to match store format
//     const cleanPhone = phone.replace(/\D/g, '');

//     // 1. Generate 6-digit OTP
//     const code = Math.floor(100000 + Math.random() * 900000).toString();
//     otpStore.set(cleanPhone, { code, expiry: Date.now() + 10 * 60 * 1000 }); 

//     try {
//         // 2. Look up the secure chat ID mapping
//         const targetChatId = phoneToChatIdStore.get(cleanPhone);

//         if (!targetChatId || !nestBot) {
//             return res.status(404).json({ 
//                 error: 'Telegram conversation not initialized. Please click the bot link and share your contact first.' 
//             });
//         }

//         // 3. Fire the live 100ms/NestJunior notification wire
//         await nestBot.sendMessage(
//             targetChatId, 
//             `Hello ${name || 'Parent'}, your Nest Junior verification code is: *${code}*.\n\nThis code will expire in 10 minutes.`,
//             { parse_mode: 'Markdown' }
//         );
        
//         res.status(200).json({ success: true, message: 'OTP Sent securely via Telegram' });
//     } catch (error) {
//         console.error("Telegram Transmission Error:", error);
//         res.status(500).json({ error: 'Failed to transmit OTP via Telegram bot engine' });
//     }
// };

// --- DRIVER SPECIFIC AUTH & ONBOARDING ---
export const sendTelegramOtp = async (req: Request, res: Response) => {
    try {
        console.log("\n--- [MOBILE APP] REQUESTING OTP ---");
        const { phone, name } = req.body;
        console.log(`1. Raw Phone from App: "${phone}"`);

        const safePhone = normalizePhoneNumber(phone);
        console.log(`2. Normalized Phone (Saving to DB): "${safePhone}"`);

        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); 

        await prisma.otpRequest.upsert({
            where: { phone: safePhone },
            update: { otp_code: otpCode, expires_at: expiresAt },
            create: { phone: safePhone, otp_code: otpCode, expires_at: expiresAt }
        });

        console.log(`3. SUCCESS! Staged OTP [${otpCode}] for [${safePhone}]`);
        res.json({ success: true, message: 'OTP Staged. Waiting for Webhook.' });
    } catch (error) {
        console.error('OTP Staging Error:', error);
        res.status(500).json({ error: 'Failed to stage OTP' });
    }
};

export const verifyDriverOtpAndRegister = async (req: Request, res: Response) => {
    console.log("\n--- [MOBILE APP] VERIFYING OTP ---");
    const { firebaseUid, name, phone, otp, expoPushToken } = req.body; 
    console.log(`1. Verification Attempt - Raw Phone: "${phone}", OTP Entered: "${otp}"`);
    
    const safePhone = normalizePhoneNumber(phone);
    console.log(`2. Querying DB for Normalized Phone: "${safePhone}"`);

    const stored = await prisma.otpRequest.findUnique({
        where: { phone: safePhone }
    });

    if (!stored) {
        console.log(`❌ ERROR: No OTP record found in DB for "${safePhone}"`);
        return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    console.log(`3. DB Record Found! Expected OTP: "${stored.otp_code}", Expires: ${stored.expires_at}`);

    if (stored.otp_code !== otp || new Date() > stored.expires_at) {
        console.log(`❌ ERROR: OTP Mismatch or Expired!`);
        return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    try {
        console.log(`4. OTP Valid! Registering/Updating Driver...`);
        const user = await prisma.nestUser.upsert({
            where: { firebaseUid },
            update: { expoPushToken },
            create: {
                firebaseUid,
                name,
                phone: safePhone, 
                role: 'DRIVER', 
                expoPushToken 
            }
        });

        await prisma.otpRequest.delete({ where: { phone: safePhone } });
        console.log(`5. SUCCESS! Registration complete, OTP deleted.`);
        res.status(200).json({ success: true, user });
    } catch (error) {
        console.error("Driver Registration error:", error);
        res.status(500).json({ error: 'Failed to register driver' });
    }
};

export const completeDriverProfile = async (req: Request, res: Response) => {
    const { firebaseUid, carModel, plateNumber, seats } = req.body;

    try {
        const user = await prisma.nestUser.findUnique({ where: { firebaseUid } });
        if (!user) return res.status(404).json({ error: 'Driver user not found' });

        // Upsert creates the profile if it doesn't exist, or updates it if it does
        const profile = await prisma.driverProfile.upsert({
            where: { nestUserId: user.id },
            update: {
                carModel,
                plateNumber,
                seats: parseInt(seats.toString(), 10)
            },
            create: {
                nestUserId: user.id,
                carModel,
                plateNumber,
                seats: parseInt(seats.toString(), 10),
                approvalStatus: 'PENDING' // Defaults to pending for Admin approval
            }
        });

        res.status(200).json({ success: true, profile });
    } catch (error) {
        console.error("Driver Profile Error:", error);
        res.status(500).json({ error: 'Failed to update driver profile' });
    }
};
export const verifyTelegramOtpAndRegister = async (req: Request, res: Response) => {
    const { firebaseUid, name, phone, otp, expoPushToken } = req.body;

    // Normalize the phone number
    const safePhone = normalizePhoneNumber(phone);

    // Query Prisma, NOT the in-memory map
    const stored = await prisma.otpRequest.findUnique({
        where: { phone: safePhone }
    });

    if (!stored || stored.otp_code !== otp || new Date() > stored.expires_at) {
        return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    try {
        const user = await prisma.nestUser.upsert({
            where: { firebaseUid },
            update: { expoPushToken },
            create: {
                firebaseUid,
                name,
                phone: safePhone, // Save the clean number to the user profile
                role: 'PARENT', 
                expoPushToken 
            }
        });

        // Delete the OTP from the database so it can't be reused
        await prisma.otpRequest.delete({ where: { phone: safePhone } }); 
        
        res.status(200).json({ success: true, user });
    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({ error: 'Failed to register user' });
    }
};

