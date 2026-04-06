import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { prisma } from '../lib/db/prisma';
import { normalizeIdentifier } from '../lib/security/normalization';
import { hashIdentifier, AliasType } from '../lib/security/hashing';

export const addAlias = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { aliasIdentifier, type } = req.body as { aliasIdentifier: string; type: AliasType };

    // 1. Initial Checks
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!aliasIdentifier || !type) {
      res.status(400).json({ error: 'Missing alias identifier or type.' });
      return;
    }

    // 2. Normalize and Hash the Input
    const standardizedAlias = normalizeIdentifier(type, aliasIdentifier);
    const hashedAlias = hashIdentifier(type, standardizedAlias);

    // 3. Atomic Transaction: Check, Charge, and Save
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ 
        where: { id: userId }, 
        include: { wallet: true } 
      });

      // Prevent duplicate aliases & double charging
      const existingAlias = await tx.alias.findFirst({
        where: { user_id: userId, hashed_value: hashedAlias }
      });

      if (existingAlias) {
        throw new Error('ALIAS_EXISTS');
      }

      // Alias costs 2 slots
      if (!user || !user.wallet || user.wallet.slots_balance < 2) { 
        throw new Error('INSUFFICIENT_FUNDS');
      }

      // Deduct 2 slots
      await tx.wallet.update({
        where: { user_id: userId },
        data: { slots_balance: { decrement: 2 } }
      });

      // Save the Alias
      await tx.alias.create({
        data: {
          user_id: userId,
          type: type,
          hashed_value: hashedAlias,
          verified: true // Automatically verified since they are actively logged in
        }
      });
    });

    res.status(200).json({ success: true, message: 'Alias Secured.' });

  } catch (error: any) {
    if (error.message === 'INSUFFICIENT_FUNDS') {
      res.status(402).json({ error: 'Adding an alias requires 2 Orbit Slots.' });
    } else if (error.message === 'ALIAS_EXISTS') {
      res.status(400).json({ error: 'You have already secured this alias in your vault.' });
    } else {
      console.error('[Add Alias Error]', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
};