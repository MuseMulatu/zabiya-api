import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

const HMS_ACCESS_KEY = process.env.HMS_ACCESS_KEY || '';
const HMS_SECRET = process.env.HMS_SECRET || '';

export const getHmsToken = async (req: Request, res: Response) => {
    try {
        const { roomId, role, userId } = req.query;

        // Ensure we have the required parameters
        if (!roomId || !role || !userId) {
            return res.status(400).json({ error: 'Missing roomId, role, or userId' });
        }

        // 100ms requires this specific payload structure
        const payload = {
            access_key: HMS_ACCESS_KEY,
            room_id: roomId,
            user_id: userId,
            role: role, // Example: 'viewer' (for parents) or 'broadcaster' (for drivers)
            type: 'app',
            version: 2,
            jti: uuidv4(), // Unique token ID
        };

        // Sign the token using your 100ms Secret
        const token = jwt.sign(payload, HMS_SECRET, {
            algorithm: 'HS256',
            expiresIn: '24h',
        });

        res.status(200).json({ token });
    } catch (error) {
        console.error('Error generating HMS token:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};