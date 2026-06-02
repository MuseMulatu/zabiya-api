import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const HMS_ACCESS_KEY = process.env.HMS_ACCESS_KEY || '';
const HMS_SECRET = process.env.HMS_SECRET || '';

const prisma = new PrismaClient();

export const requestLookIn = async (req: Request, res: Response) => {
    try {
        const { routeId } = req.body;
        const route = await prisma.routeSubscription.findUnique({ 
            where: { id: routeId },
            include: { driver: { include: { user: true } } } 
        });

        if (!route || !route.driver) return res.status(404).json({ error: 'Route or driver not found' });

        // 1. Check Daily Limits
        const today = new Date().toDateString();
        const lastLookIn = route.lastLookInDate ? route.lastLookInDate.toDateString() : '';

        let currentCount = route.dailyLookInCount;
        if (today !== lastLookIn) {
            currentCount = 0; // Reset count if it's a new day
        }

        if (currentCount >= 3) {
            return res.status(429).json({ error: 'Daily look-in limit (3) reached for this ride.' });
        }

        // 2. Increment Count in DB
        await prisma.routeSubscription.update({
            where: { id: routeId },
            data: { 
                dailyLookInCount: currentCount + 1,
                lastLookInDate: new Date()
            }
        });

        // 3. Ping the Driver via Expo Push Notifications
        // Assuming you store the driver's Expo Push Token in the User model
        const driverPushToken = "ExponentPushToken[xxxxx]"; // Fetch from route.driver.user.expoToken

        await axios.post('https://exp.host/--/api/v2/push/send', {
            to: driverPushToken,
            title: "Parent Look-In Requested",
            body: "Broadcasting dashcam for 30 seconds...",
            data: { 
                type: 'START_LOOK_IN_BROADCAST', 
                roomId: route.hmsRoomId 
            },
            priority: 'high'
        });

        res.status(200).json({ success: true, remaining: 2 - currentCount });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getHmsToken = async (req: Request, res: Response) => {
    try {
        const { roomId, role, userId } = req.query;

        // Ensure we have the required parameters
        if (!roomId || !role || !userId) {
            return res.status(400).json({ error: 'Missing roomId, role, or userId' });
        }

        const payload = {
            access_key: HMS_ACCESS_KEY,
            room_id: roomId,
            user_id: userId,
            role: role, 
            type: 'app',
            version: 2,
            jti: crypto.randomUUID(), // <--- CHANGED THIS LINE
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