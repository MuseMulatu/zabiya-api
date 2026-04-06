import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth'; 
import { initializePayment, handleWebhook } from '../controllers/payment';
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

// POST /api/payment/webhook
// Public: ArifPay's servers hit this endpoint to confirm payment success/failure
router.post('/webhook', handleWebhook);

export default router;