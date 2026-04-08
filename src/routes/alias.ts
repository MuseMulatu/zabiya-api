// src/routes/alias.ts
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth';

import { 
  requestAliasOtp, 
  verifyAndAddAlias, 
  quickActivateTelegram 
} from '../controllers/alias';

const router = Router();

/**
 * 🛡️ Security: Alias Rate Limiting
 * Since adding an alias costs 2 slots, we want to prevent 
 * rapid-fire requests that could deplete a user's wallet 
 * due to UI glitches or double-clicks.
 */
const aliasLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 15, // Limit each IP to 15 alias requests per window
  message: { error: 'Too many alias requests. Please wait a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ------------------------------------------------------------------
// 🚀 ENDPOINTS
// ------------------------------------------------------------------

/**
 * 1. POST /api/alias/request-otp
 * @desc Generates an OTP and tells the frontend to redirect to the Bot.
 * @access Private (Requires JWT)
 */
router.post('/request-otp', aliasLimiter, requireAuth, requestAliasOtp);

/**
 * 2. POST /api/alias/verify
 * @desc Verifies the OTP, deducts 2 slots, adds the alias, and checks for instant matches.
 * @access Private (Requires JWT)
 */
router.post('/verify', aliasLimiter, requireAuth, verifyAndAddAlias);

/**
 * 3. POST /api/alias/quick-activate
 * @desc Upsell! Bypasses OTP to instantly activate a known Telegram handle. Deducts 2 slots.
 * @access Private (Requires JWT)
 */
router.post('/quick-activate', aliasLimiter, requireAuth, quickActivateTelegram);

export default router;