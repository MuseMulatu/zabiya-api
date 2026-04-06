// src/routes/alias.ts
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth';
import { addAlias } from '../controllers/alias';

const router = Router();

/**
 * 🛡️ Security: Alias Rate Limiting
 * Since adding an alias costs 2 slots, we want to prevent 
 * rapid-fire requests that could deplete a user's wallet 
 * due to UI glitches or double-clicks.
 */
const aliasLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 15, // Limit each IP to 15 alias creations per window
  message: { error: 'Too many alias requests. Please wait a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ------------------------------------------------------------------
// 🚀 ENDPOINTS
// ------------------------------------------------------------------

/**
 * POST /api/alias/add
 * @desc Securely adds a new verified alias (Phone, TG, or IG) to the user's vault.
 * @access Private (Requires JWT)
 * @cost 2 Orbit Slots
 */
router.post('/add', aliasLimiter, requireAuth, addAlias);

export default router;