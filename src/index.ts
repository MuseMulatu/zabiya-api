import 'dotenv/config';
import express, { Application } from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import paymentRoutes from './routes/payment'; 
import intentRoutes from './routes/intent'; 
import aliasRoutes from './routes/alias';

const app: Application = express();
const PORT = process.env.PORT || 3000;

// 🚨 TRUST PROXY FIX: Tells Express to trust Nginx so the rate limiter works
app.set('trust proxy', 1);

// Hardcoded array for bulletproof CORS
const allowedOrigins = [
  'http://localhost:5173', // Local Vite
  'http://localhost:3000', // Local Next.js/React
  'https://zabiya.com',    // Production Frontend
  'https://www.zabiya.com' // Production Frontend (www)
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, or Postman)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // 🚨 Pro-Tip: Log exactly what is being rejected so you can fix it easily!
      console.error(`🚨 [CORS Blocked] Origin rejected: ${origin}`);
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
app.use('/api/alias', aliasRoutes);

app.listen(PORT, () => {
  console.log(`🚀 [System] Zabiya Engine securely running on port ${PORT}`);
});

export default app;