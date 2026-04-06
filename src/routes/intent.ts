import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { addIntent, blockMatch, getDashboard, revokeIntent, unblockUser } from '../controllers/intent';
import rateLimit from 'express-rate-limit';

const router = Router();

// Rate limiting: Protect the Match Engine from brute force/spam
// Max 10 intent submissions per hour per user
const intentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, 
  max: 10,
  message: { error: 'You have reached the maximum number of intent submissions for this hour.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Protect all intent/dashboard routes with JWT Auth
router.use(requireAuth);

// Endpoints
router.post('/add', intentLimiter, addIntent);
router.post('/:id/revoke', revokeIntent);
router.post('/:id/block', blockMatch);
router.post('/:id/unblock', unblockUser);

router.get('/dashboard', getDashboard);

export default router;