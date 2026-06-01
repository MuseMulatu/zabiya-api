import { Request, Response } from 'express';
import { prisma } from '../lib/db/prisma';
import crypto from 'crypto';

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
        // Explicitly cast to string
        const routeId = req.params.routeId as string;
        const driverId = req.body.driverId as string;
        const monthlyFee = req.body.monthlyFee;
        
        const route = await prisma.routeSubscription.update({
            where: { id: routeId },
data: {
                driverId,
                monthlyFee: parseFloat(monthlyFee),
                paymentStatus: 'UNPAID', // Parent now needs to pay this fee to activate
                hmsRoomId: crypto.randomUUID() // Create the unique Live Camera Room ID for this route
            }
        });

        // TODO: In the future, trigger a Telegram notification to the Parent here saying:
        // "Your route has been assigned a driver! Please open the app to pay the fee of ${monthlyFee} ETB."

        res.json({ success: true, route });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to assign route' });
    }
};