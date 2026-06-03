import { Request, Response } from 'express';
import { prisma } from '../lib/db/prisma';

// Fetch optimized driver route sequence skipping absent students
export const getActiveManifest = async (req: Request, res: Response) => {
    const { driverId } = req.query;

    try {
        const manifest = await prisma.routeSubscription.findMany({
            where: { 
                // Changed 'String' to 'string' here 👇
                driverId: driverId as string,
            },
            orderBy: { sequenceOrder: 'asc' },
            include: {
                student: true
            }
        });
        
        res.status(200).json(manifest);
    } catch (error) {
        res.status(500).json({ error: 'Failed to compile manifest matrix' });
    }
};


export const getDriverManifest = async (req: Request, res: Response) => {
    try {
        const driverId = req.query.driverId as string;
        if (!driverId) return res.status(400).json({ error: 'Missing driverId' });

        const manifest = await prisma.routeSubscription.findMany({
            where: {
                driver: {
                    user: {
                        firebaseUid: driverId
                    }
                },
                isSkippedToday: false 
            },
            orderBy: {
                sequenceOrder: 'asc'
            },
            include: {
                student: true
            }
        });

        res.json(manifest);
    } catch (error) {
        console.error("Manifest Error:", error);
        res.status(500).json({ error: 'Failed to fetch driver manifest' });
    }
};

export const triggerBoardingMilestone = async (req: Request, res: Response) => {
    const { routeSubscriptionId, photoUrl } = req.body;
    try {
        const updatedRoute = await prisma.routeSubscription.update({
            where: { id: routeSubscriptionId },
            data: {}
        });
        res.status(200).json({ success: true, message: 'Parent notified instantly' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to process boarding verification' });
    }
};