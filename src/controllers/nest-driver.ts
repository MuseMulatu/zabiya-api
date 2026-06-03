import { Request, Response } from 'express';
import { prisma } from '../lib/db/prisma';

// Fetch optimized driver route sequence skipping absent students
export const getActiveManifest = async (req: Request, res: Response) => {
    // Explicitly cast to string right at extraction
    const driverId = req.query.driverId as string;

    if (!driverId) {
        return res.status(400).json({ error: 'Missing driverId' });
    }

    try {
        const manifest = await prisma.routeSubscription.findMany({
            where: { 
                driverId: driverId, 
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

// --- DRIVER UPLOAD ENDPOINTS ---

// 1. 30-Second GPS Telemetry Receiver
export const updateTelemetry = async (req: Request, res: Response) => {
    const { latitude, longitude } = req.body;
    const routeSubscriptionId = req.body.routeSubscriptionId as string; // Explicit cast

    try {
        // A. Insert historical log (for path reconstruction)
        await prisma.vehicleLocationLog.create({
            data: { routeSubscriptionId, latitude, longitude }
        });
        
        // B. Update flat live fields (for real-time parent tracking)
        await prisma.routeSubscription.update({
            where: { id: routeSubscriptionId },
            data: { currentLat: latitude, currentLng: longitude, lastLocationTime: new Date() }
        });
        
        res.status(200).json({ success: true });
    } catch (error) {
        console.error("Telemetry Error:", error);
        res.status(500).json({ error: 'Telemetry update failed' });
    }
};

// 2. Snapshot/Milestone Receiver
export const triggerBoardingMilestone = async (req: Request, res: Response) => {
    const { photoUrl, type } = req.body; 
    const routeSubscriptionId = req.body.routeSubscriptionId as string; // Explicit cast

    try {
        await prisma.routeMilestone.create({
            data: { 
                routeSubscriptionId, 
                photoUrl, 
                type: type || 'BOARDING' // 'PERIODIC' or 'BOARDING'
            }
        });
        res.status(200).json({ success: true, message: 'Snapshot securely logged' });
    } catch (error) {
        console.error("Milestone Error:", error);
        res.status(500).json({ error: 'Failed to log snapshot' });
    }
};

// --- PARENT FETCH ENDPOINTS ---

// 3. Fast Live Coords Fetcher
export const getLiveRouteData = async (req: Request, res: Response) => {
    const routeId = req.params.routeId as string; // Explicit cast
    
    try {
        const route = await prisma.routeSubscription.findUnique({
            where: { id: routeId },
            select: { currentLat: true, currentLng: true, lastLocationTime: true }
        });
        res.json(route);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch live coordinates' });
    }
};

// 4. Historical Path & Snapshot Gallery Fetcher
export const getRouteHistory = async (req: Request, res: Response) => {
    const routeId = req.params.routeId as string; // Explicit cast
    
    try {
        const [logs, milestones] = await Promise.all([
            prisma.vehicleLocationLog.findMany({
                where: { routeSubscriptionId: routeId },
                orderBy: { createdAt: 'asc' }, 
                select: { latitude: true, longitude: true, createdAt: true }
            }),
            prisma.routeMilestone.findMany({
                where: { routeSubscriptionId: routeId },
                orderBy: { createdAt: 'desc' } 
            })
        ]);
        res.json({ path: logs, snapshots: milestones });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch history' });
    }
};