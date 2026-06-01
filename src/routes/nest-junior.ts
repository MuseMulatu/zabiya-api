import { Router, Request, Response } from 'express';
import { getHmsToken } from '../controllers/nest-junior';
import { nestBot } from '../lib/notifications/nestJuniorBot';
// Add the new imports at the top
import { checkUser, sendTelegramOtp, verifyTelegramOtpAndRegister, verifyDriverOtpAndRegister, completeDriverProfile } from '../controllers/nest-junior-auth';
import { getActiveManifest, triggerBoardingMilestone } from '../controllers/nest-driver';

const router = Router();

// --- 100ms LIVE STREAMING ROUTES ---
// Endpoint: https://api.zabiya.com/api/nest-junior/hms-token
router.get('/hms-token', getHmsToken);
router.get('/driver/manifest', getActiveManifest);
router.post('/driver/milestone', triggerBoardingMilestone);

// --- AUTHENTICATION & OTP ROUTES ---
router.post('/auth/check-user', checkUser);
router.post('/auth/send-telegram-otp', sendTelegramOtp);
router.post('/auth/verify-telegram-otp-and-register', verifyTelegramOtpAndRegister);

router.post('/auth/driver/verify-otp-and-register', verifyDriverOtpAndRegister);
router.post('/auth/driver/complete-profile', completeDriverProfile);
// --- TELEGRAM WEBHOOK ENDPOINT ---
router.post('/auth/telegram-webhook', (req: Request, res: Response) => {
    if (nestBot) {
        // Feed the incoming body directly into the library's processing engine
        nestBot.processUpdate(req.body);
    }
    // Always return a 200 OK immediately to Telegram so it doesn't retry
    res.sendStatus(200);
});

export default router;