import { Request, Response } from 'express';
import { prisma } from '../lib/db/prisma';
//import { nestBot, phoneToChatIdStore } from '../lib/notifications/nestJuniorBot';


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

export const verifyDriverOtpAndRegister = async (req: Request, res: Response) => {
    // 1. Add expoPushToken to the extracted fields
    const { firebaseUid, name, phone, otp, expoPushToken } = req.body; 
    const cleanPhone = phone.replace(/\D/g, '');

    const stored = otpStore.get(cleanPhone);
    if (!stored || stored.code !== otp || Date.now() > stored.expiry) {
        return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    try {
        // 2. Use 'upsert' to gracefully handle both New Registration and Re-Logins
        const user = await prisma.nestUser.upsert({
            where: { firebaseUid },
            update: {
                expoPushToken // If the user already exists, update their token to the new device's token
            },
            create: {
                firebaseUid,
                name,
                phone,
                role: 'DRIVER', 
                expoPushToken // Save the token on their first registration
            }
        });

        otpStore.delete(cleanPhone); // Clear the OTP
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
    // 1. Extract expoPushToken from the request body
    const { firebaseUid, name, phone, otp, expoPushToken } = req.body;

    // Clean the phone number to accurately match the key stored in sendTelegramOtp
    const cleanPhone = phone.replace(/\D/g, '');

    const stored = otpStore.get(cleanPhone);
    if (!stored || stored.code !== otp || Date.now() > stored.expiry) {
        return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    try {
        // 2. Use 'upsert' to gracefully handle both New Registration and Re-Logins for Parents
        const user = await prisma.nestUser.upsert({
            where: { firebaseUid },
            update: {
                expoPushToken // If the parent already exists, update to their current device's token
            },
            create: {
                firebaseUid,
                name,
                phone,
                role: 'PARENT', 
                expoPushToken // Save the token on their very first registration
            }
        });

        otpStore.delete(cleanPhone); 
        res.status(200).json({ success: true, user });
    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({ error: 'Failed to register user' });
    }
};


export const sendTelegramOtp = async (req: Request, res: Response) => {
    try {
        let { phone, name } = req.body;

        // Normalization fallback just in case the frontend sends +251
        if (phone.startsWith('+251')) phone = '0' + phone.slice(4);

        // 1. Generate a 6-digit OTP
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

        // 2. Stage OTP in Database (Expires in 10 mins)
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); 
        await prisma.otpRequest.upsert({
            where: { phone },
            update: { otp_code: otpCode, expires_at: expiresAt },
            create: { phone, otp_code: otpCode, expires_at: expiresAt }
        });

        // 3. We respond instantly. We DO NOT message the bot here. 
        // We wait for the user to open the bot and share their contact.
        res.json({ success: true, message: 'OTP Staged. Waiting for Webhook verification.' });

    } catch (error) {
        console.error('OTP Staging Error:', error);
        res.status(500).json({ error: 'Failed to stage OTP' });
    }
};
