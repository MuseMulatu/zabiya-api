import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { adminLogin, getAdminStats, getAllUsers, getUserDetails } from '../controllers/admin';
import { 
    getPendingDrivers, approveDriver, getApprovedDrivers, 
    getUnassignedRoutes, assignDriverToRoute, getPendingPayments, activateRoute  
} from '../controllers/nest-admin';

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

// ... existing general admin routes ...

// Mount Nest Junior Admin Routes
router.get('/nest-junior/drivers/pending', getPendingDrivers);
router.post('/nest-junior/drivers/:id/approve', approveDriver);
router.get('/nest-junior/drivers/approved', getApprovedDrivers);

router.get('/nest-junior/routes/unassigned', getUnassignedRoutes);
router.post('/nest-junior/routes/:routeId/assign', assignDriverToRoute);

// NEST JUNIOR ADMIN ROUTES
router.get('/nest/drivers/pending', getPendingDrivers);
router.post('/nest/drivers/:id/approve', approveDriver);
router.get('/nest/drivers/approved', getApprovedDrivers);

router.get('/nest/routes/unassigned', getUnassignedRoutes);
router.post('/nest/routes/:routeId/assign', assignDriverToRoute); // The "Quote & Assign" step

// NEW: Payment & Activation Routes
router.get('/nest/routes/pending-payment', getPendingPayments);
router.post('/nest/routes/:routeId/activate', activateRoute); // The "Activate & Livestream" step


export default router;