import express, { Request, Response } from 'express';
import { getHmsToken, requestLookIn, requestRide, submitReceipt } from '../controllers/nest-junior';
import { checkUser, sendTelegramOtp, verifyTelegramOtpAndRegister, verifyDriverOtpAndRegister, completeDriverProfile } from '../controllers/nest-junior-auth';
import { getDriverManifest, triggerBoardingMilestone } from '../controllers/nest-driver';
import { handleNestJuniorWebhook, nestBot } from '../lib/notifications/nestJuniorBot';

const router = express.Router();

// --- TELEGRAM WEBHOOK ROUTES ---
// The POST route for Telegram
router.post('/webhook', handleNestJuniorWebhook);

// The GET route for your Browser (Health Check)
router.get('/webhook', (req, res) => {
    res.status(200).json({ status: "🟢 Nest Junior Webhook Router is LIVE and reachable!" });
});

router.post('/auth/telegram-webhook', (req: Request, res: Response) => {
    if (nestBot) {
        nestBot.processUpdate(req.body);
    }
    res.sendStatus(200);
});

// --- AUTHENTICATION & OTP ROUTES ---
router.post('/auth/check-user', checkUser);
router.post('/auth/send-telegram-otp', sendTelegramOtp);
router.post('/auth/verify-telegram-otp-and-register', verifyTelegramOtpAndRegister);
router.post('/auth/driver/verify-otp-and-register', verifyDriverOtpAndRegister);
router.post('/auth/driver/complete-profile', completeDriverProfile);

// --- 100ms LIVE STREAMING ROUTES ---
router.get('/hms-token', getHmsToken);
router.get('/token', getHmsToken); // Legacy fallback
router.post('/look-in', requestLookIn);

// --- DRIVER ROUTES ---
// 🚨 THIS IS THE FIX: Only one manifest route, pointing to the correct function!
router.get('/driver/manifest', getDriverManifest);
router.post('/driver/milestone', triggerBoardingMilestone);

// --- PARENT ROUTES ---
router.post('/routes/request', requestRide);
router.post('/routes/receipt', submitReceipt);

export default router;