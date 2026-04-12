import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { prisma } from '../lib/db/prisma';

export const verifyTelebirrTransaction = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const { transactionId, packageType } = req.body;

    if (!transactionId || !packageType) {
      res.status(400).json({ error: 'Missing transaction details.' });
      return;
    }

    const upperTxId = transactionId.toUpperCase();

    // 1. 🛡️ DOUBLE-SPEND PROTECTION (Has this user already claimed it?)
    const existingTx = await prisma.transaction.findFirst({
      where: { nonce: upperTxId } 
    });
    
    if (existingTx) {
      res.status(409).json({ error: 'This Transaction ID has already been claimed.' });
      return;
    }

    // 2. 🔍 LOOK IN THE RECEIPT POOL
    const receipt = await prisma.telebirrReceipt.findUnique({
      where: { transaction_id: upperTxId }
    });

    if (!receipt) {
      res.status(404).json({ error: 'Receipt not found. If you just paid, please wait 30 seconds and click verify again.' });
      return;
    }

    if (receipt.status === 'CLAIMED') {
      res.status(409).json({ error: 'This receipt was already claimed by another user.' });
      return;
    }

    // 3. 💰 VERIFY THE AMOUNT
    const expectedAmount = packageType === 'premium' ? 199 : 149;
    
    // Allow them to overpay (e.g. they sent 150 instead of 149), but not underpay
    if (receipt.amount < expectedAmount) {
      res.status(400).json({ error: `Amount paid (${receipt.amount} ETB) is less than required (${expectedAmount} ETB).` });
      return;
    }

    // 4. 🎉 DISBURSEMENT
    const slotsToAdd = packageType === 'premium' ? 6 : 3;

    await prisma.$transaction(async (tx) => {
      // Mark receipt as claimed in the pool
      await tx.telebirrReceipt.update({
        where: { id: receipt.id },
        data: { status: 'CLAIMED' }
      });

      // Create official transaction record
      await tx.transaction.create({
        data: {
          user_id: userId,
          session_id: `telebirr_${upperTxId}`,
          nonce: upperTxId, 
          amount: receipt.amount,
          package_type: packageType,
          status: 'SUCCESS',
          expire_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) 
        }
      });

      // Credit Wallet
      await tx.wallet.update({
        where: { user_id: userId },
        data: { slots_balance: { increment: slotsToAdd } }
      });
    });

    res.json({ success: true, message: 'Payment verified! Slots added to your wallet.' });

  } catch (error) {
    console.error('[Telebirr Verifier Error]', error);
    res.status(500).json({ error: 'Internal server error while verifying payment.' });
  }
};