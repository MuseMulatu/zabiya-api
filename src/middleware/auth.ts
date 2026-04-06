import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// 1. Explicitly cast process.env to string to resolve 'string | undefined' errors
const JWT_SECRET = process.env.JWT_SECRET as string;

if (!JWT_SECRET) {
  throw new Error('CRITICAL: JWT_SECRET environment variable is missing.');
}

// Extend Express Request to include our trusted user payload
export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    chatId: string;
  };
}

export const requireAuth = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: Missing or invalid Bearer token.' });
    return;
  }

  const token = authHeader.split(' ')[1];

  // 2. Strict null check to ensure 'token' is definitely a string before passing to verify()
  if (!token) {
    res.status(401).json({ error: 'Unauthorized: Malformed Bearer token.' });
    return;
  }

  try {
    // 3. Fix TS2352: Cast to 'unknown' first to safely narrow the JwtPayload union type
    const decoded = jwt.verify(token, JWT_SECRET) as unknown as { userId: string; chatId: string };
    
    // Attach the trusted, decoded payload to the request
    req.user = decoded;
    next();
  } catch (error) {
    console.error('[JWT Verification Error]', error);
    res.status(401).json({ error: 'Unauthorized: Token expired or invalid.' });
  }
};