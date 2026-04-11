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

    // 1. 🛡️ DOUBLE-SPEND PROTECTION
    // We use your existing 'nonce' column to store the ID so it strictly enforces uniqueness!
    const existingTx = await prisma.transaction.findFirst({
      where: { nonce: transactionId } 
    });
    
    if (existingTx) {
      res.status(409).json({ error: 'This Transaction ID has already been claimed.' });
      return;
    }

    // 2. 🌐 SCRAPE TELEBIRR RECEIPT
    const url = `https://transactioninfo.ethiotelecom.et/receipt/${transactionId}`;
    const response = await fetch(url);
    const html = await response.text();

    if (!html || html.includes('No Data Found') || html.includes('Invalid')) {
      res.status(404).json({ error: 'Invalid Transaction ID. Receipt not found.' });
      return;
    }

    // 3. 🔍 VALIDATION LOGIC
    // A. Verify Recipient (Muse Mulatu or the masked number)
    const isCorrectRecipient = html.includes('Muse Mulatu') || html.includes('3090');
    if (!isCorrectRecipient) {
      res.status(400).json({ error: 'Payment was not sent to the official Zabiya account.' });
      return;
    }

    // B. Verify Status
    if (!html.includes('Completed') && !html.includes('completed')) {
      res.status(400).json({ error: 'Transaction is not marked as Completed by Telebirr.' });
      return;
    }

    // C. Verify Amount
    const expectedAmount = packageType === 'premium' ? 199 : 149;
    // The receipt formats exactly like "149.00 Birr" or "149.00". We search the raw HTML.
    if (!html.includes(`${expectedAmount}.00`)) {
      res.status(400).json({ error: `Amount does not match the requested package (${expectedAmount} ETB).` });
      return;
    }

    // 4. 💰 DISBURSEMENT (Reusing your exact schema)
    const slotsToAdd = packageType === 'premium' ? 6 : 3;

    await prisma.$transaction(async (tx) => {
      // Record the transaction to prevent future reuse
      await tx.transaction.create({
        data: {
          user_id: userId,
          session_id: `telebirr_${transactionId}`, // Fits schema
          nonce: transactionId, // Fits unique schema constraint
          amount: expectedAmount,
          package_type: packageType,
          status: 'SUCCESS', // Automatically marked successful
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
    res.status(500).json({ error: 'Failed to verify transaction.' });
  }
};