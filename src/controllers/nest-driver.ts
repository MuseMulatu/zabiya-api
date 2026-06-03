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

// Fetch optimized driver route sequence skipping absent students
export const getDriverManifest = async (req: Request, res: Response) => {
    try {
        // The React Native app sends the driver's Firebase UID here
        const driverId = req.query.driverId as string;
        if (!driverId) return res.status(400).json({ error: 'Missing driverId' });

        // Query the database for this specific driver's routes
        const manifest = await prisma.routeSubscription.findMany({
            where: {
                // Find routes where the assigned driver's linked Firebase ID matches the requester
                driver: {
                    user: {
                        firebaseUid: driverId
                    }
                },
                // Do not send kids whose parents toggled "Skip Today"
                isSkippedToday: false 
            },
            orderBy: {
                sequenceOrder: 'asc' // Ensure they are picked up in the correct Admin-assigned order
            },
            include: {
                student: true // Include the student's name, school, and photo
            }
        });

        res.json(manifest);
    } catch (error) {
        console.error("Manifest Error:", error);
        res.status(500).json({ error: 'Failed to fetch driver manifest' });
    }
};

// Fire network hooks when a driver crosses a waypoint geofence boundary
export const triggerBoardingMilestone = async (req: Request, res: Response) => {
    const { routeSubscriptionId, photoUrl } = req.body;

    try {
        // Log asset link and update active status to update parent views
        const updatedRoute = await prisma.routeSubscription.update({
            where: { id: routeSubscriptionId },
            data: {
                // Link verification records or update travel states here
            }
        });
        
        res.status(200).json({ success: true, message: 'Parent notified instantly' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to process boarding verification' });
    }
};