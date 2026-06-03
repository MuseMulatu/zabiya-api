import { Request, Response } from 'express';
import { prisma } from '../lib/db/prisma';
import crypto from 'crypto';
import { createHmsRoom } from '../lib/100ms';
// --- 1. DRIVER APPROVALS ---

export const getPendingDrivers = async (req: Request, res: Response) => {
    try {
        const drivers = await prisma.driverProfile.findMany({
            where: { approvalStatus: 'PENDING' },
            include: { user: true } // Pulls in the NestUser data (name, phone)
        });
        res.json(drivers);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch pending drivers' });
    }
};


export const approveDriver = async (req: Request, res: Response) => {
    try {
        // Explicitly cast to string
        const id = req.params.id as string; 
        
        const driver = await prisma.driverProfile.update({
            where: { id },
            data: { approvalStatus: 'APPROVED' }
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to approve driver' });
    }
};

export const getApprovedDrivers = async (req: Request, res: Response) => {
    try {
        const drivers = await prisma.driverProfile.findMany({
            where: { approvalStatus: 'APPROVED' },
            include: { user: true }
        });
        res.json(drivers);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch approved drivers' });
    }
};

// --- 2. ROUTE ASSIGNMENTS ---

export const getUnassignedRoutes = async (req: Request, res: Response) => {
    try {
        const routes = await prisma.routeSubscription.findMany({
            where: { driverId: null },
            include: { 
                student: { 
                    include: { parents: { include: { user: true } } } 
                } 
            }
        });
        res.json(routes);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch requested routes' });
    }
};


export const assignDriverToRoute = async (req: Request, res: Response) => {
    try {
        const routeId = req.params.routeId as string;
        const driverId = req.body.driverId as string;
        const monthlyFee = req.body.monthlyFee;

        // Step 1: "Soft Assign" and set the price. 
        // DO NOT create the 100ms room yet. Wait for the money!
        const route = await prisma.routeSubscription.update({
            where: { id: routeId },
            data: {
                driverId, // Soft assigned
                monthlyFee: parseFloat(monthlyFee),
                paymentStatus: 'UNPAID', // Parent must now pay this fee
            }
        });

        // TODO: Trigger Telegram to Parent: 
        // "We found a driver! Your monthly fee is ${monthlyFee} ETB. Please pay to activate your route."

        res.json({ success: true, route });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to assign route' });
    }
};



// 1. Fetch routes where the parent has uploaded a receipt
export const getPendingPayments = async (req: Request, res: Response) => {
    try {
        const routes = await prisma.routeSubscription.findMany({
            where: { paymentStatus: 'PENDING_VERIFICATION' },
            include: {
                student: { include: { parents: { include: { user: true } } } },
                driver: { include: { user: true } }
            }
        });
        res.json(routes);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch pending payments' });
    }
};

// 2. Admin verifies the receipt and ACTIVATES the route (Livestream generated here)
export const activateRoute = async (req: Request, res: Response) => {
    try {
        const routeId = req.params.routeId as string;

        // Verify route exists and has a driver assigned
        const existingRoute = await prisma.routeSubscription.findUnique({ where: { id: routeId } });
        if (!existingRoute || !existingRoute.driverId) {
            return res.status(400).json({ error: 'Route must have an assigned driver before activation' });
        }

        // Generate the real 100ms room now that money is verified
        const realRoomId = await createHmsRoom(`Route_${routeId}`);

        const route = await prisma.routeSubscription.update({
            where: { id: routeId },
            data: {
                paymentStatus: 'ACTIVE', 
                hmsRoomId: realRoomId // Livestream is now securely attached!
            }
        });

        // TODO: Push Notification to Parent -> "Your payment is approved, ride is active!"

        res.json({ success: true, route });
    } catch (error) {
        console.error('Activation Error:', error);
        res.status(500).json({ error: 'Failed to activate route' });
    }
};

export const getActiveRoutesForAudit = async (req: Request, res: Response) => {
    try {
        // Fetches all routes, including their GPS tracks and Snapshot galleries
        const routes = await prisma.routeSubscription.findMany({
            where: { paymentStatus: 'ACTIVE' },
            include: {
                student: true,
                driver: { include: { user: true } },
                milestones: { orderBy: { createdAt: 'desc' } }, // Newest photos first
                locationLogs: { orderBy: { createdAt: 'asc' } } // Sequential GPS track
            }
        });
        res.json(routes);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch audit data' });
    }
};