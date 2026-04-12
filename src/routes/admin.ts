import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { adminLogin, getAdminStats, getAllUsers, getUserDetails } from '../controllers/admin';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET as string;

// Middleware to protect admin routes
const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) { res.status(401).json({ error: 'No token' }); return; }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { role?: string };
    if (decoded.role !== 'god_mode') throw new Error('Not Admin');
    next();
  } catch (err) {
    res.status(403).json({ error: 'Forbidden' });
  }
};

// Routes
router.post('/login', adminLogin);
router.get('/dashboard', requireAdmin, getAdminStats);
router.get('/users', requireAdmin, getAllUsers);
router.get('/users/:id', requireAdmin, getUserDetails);

export default router;