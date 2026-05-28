import { Router } from 'express';
import { getHmsToken } from '../controllers/nest-junior';

import { checkUser, sendTelegramOtp, verifyTelegramOtpAndRegister } from '../controllers/nest-junior-auth';
const router = Router();

// Endpoint: https://api.zabiya.com/api/nest-junior/hms-token
router.get('/hms-token', getHmsToken);
// Auth Routes
router.post('/auth/check-user', checkUser);
router.post('/auth/send-telegram-otp', sendTelegramOtp);
router.post('/auth/verify-telegram-otp-and-register', verifyTelegramOtpAndRegister);
export default router;