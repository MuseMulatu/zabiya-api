import 'dotenv/config';
import express, { Application } from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import paymentRoutes from './routes/payment'; // Assuming this was added
import intentRoutes from './routes/intent'; 

const app: Application = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',');

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Strict CORS Policy Violation'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

// 🚨 FINTECH FIX: Capture raw body buffer for precise HMAC validation
app.use(express.json({ 
  limit: '10kb',
  verify: (req: any, res, buf) => {
    req.rawBody = buf;
  }
})); 

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/intent', intentRoutes);
app.use('/api/payment', paymentRoutes);

app.listen(PORT, () => {
  console.log(`🚀 [System] Zabiya Engine securely running on port ${PORT}`);
});

export default app;