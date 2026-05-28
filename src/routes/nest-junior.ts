import { Router, Request, Response } from 'express';
import { getHmsToken } from '../controllers/nest-junior';
import { checkUser, sendTelegramOtp, verifyTelegramOtpAndRegister } from '../controllers/nest-junior-auth';
import { nestBot } from '../lib/notifications/nestJuniorBot';

const router = Router();

// --- 100ms LIVE STREAMING ROUTES ---
// Endpoint: https://api.zabiya.com/api/nest-junior/hms-token
router.get('/hms-token', getHmsToken);

// --- AUTHENTICATION & OTP ROUTES ---
router.post('/auth/check-user', checkUser);
router.post('/auth/send-telegram-otp', sendTelegramOtp);
router.post('/auth/verify-telegram-otp-and-register', verifyTelegramOtpAndRegister);

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