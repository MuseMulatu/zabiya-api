import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth'; 
// 1. 👈 Add handleSmsWebhook to your imports
import { initializePayment, handleWebhook, handleSmsWebhook } from '../controllers/payment';
import { verifyTelebirrTransaction } from '../controllers/telebirr';

const router = Router();

// Rate limiting: Prevent spamming of the payment gateway init endpoint
const initLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Max 10 initialization attempts per window
  message: { error: 'Too many payment requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/payment/initialize
// Protected: Only authenticated users can generate a checkout session
router.post('/initialize', initLimiter, requireAuth, initializePayment);

// POST /api/payment/telebirr-verify
// Protected: Users click verify on the frontend to check the receipt pool
router.post('/telebirr-verify', requireAuth, verifyTelebirrTransaction);

// POST /api/payment/webhook
// Public: ArifPay's servers hit this endpoint to confirm payment success/failure
router.post('/webhook', handleWebhook);

// 2. 👈 POST /api/payment/sms-webhook
// Public: MacroDroid hits this endpoint to dump Telebirr texts into the database pool
router.post('/sms-webhook', handleSmsWebhook); 

export default router;