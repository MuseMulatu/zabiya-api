import { Router } from 'express';
import { getHmsToken } from '../controllers/nest-junior';

const router = Router();

// Endpoint: https://api.zabiya.com/api/nest-junior/hms-token
router.get('/hms-token', getHmsToken);

export default router;