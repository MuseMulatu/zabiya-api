import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requestOtp, verifyOtp, handleTelegramWebhook, updateDemographics } from '../controllers/auth';
import { requireAuth } from '../middleware/auth'; // Ensure this path is correct

const router = Router();

// Rate Limiting: Max 10 attempts per 15 minutes per IP to prevent OTP spam
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 10, 
  message: { error: 'Too many requests from this IP, please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// --- NEW OTP AUTH FLOW ---
router.post('/request-otp', authLimiter, requestOtp);
router.post('/verify-otp', authLimiter, verifyOtp);

// --- TELEGRAM WEBHOOK ---
// (The bot uses this to send the OTP to the user's phone)
router.post('/telegram/webhook', handleTelegramWebhook);

// --- DEMOGRAPHICS ---
// (Protected by JWT middleware)
router.post('/user/demographics', authLimiter, requireAuth, updateDemographics);

export default router;