import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { prisma } from '../lib/db/prisma';

/**
 * Robust Fetch Wrapper with Exponential Backoff Retries
 */
const fetchWithRetry = async (url: string, retries = 3, backoff = 2000): Promise<globalThis.Response> => { // 👈 FIX IS HERE
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 👈 30 seconds!
    
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    return response;
  } catch (error: any) {
    if (retries > 0) {
      console.warn(`⚠️ [Telebirr Fetch] Network issue or timeout. Retrying in ${backoff/1000}s... (${retries} attempts left)`);
      await new Promise(resolve => setTimeout(resolve, backoff));
      return fetchWithRetry(url, retries - 1, backoff * 1.5);
    }
    throw new Error(`Failed to fetch after multiple attempts: ${error.message}`);
  }
};

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


// 2. 🌐 SCRAPE TELEBIRR RECEIPT (With ScraperAPI & Retries)
    // 🚨 PRO TIP: Move this API key to your .env file later! (e.g., process.env.SCRAPER_API_KEY)
    const SCRAPER_API_KEY = 'd16d7608804dafe063dc80e7ed20db9e'; 
    const targetUrl = encodeURIComponent(`https://transactioninfo.ethiotelecom.et/receipt/${transactionId}`);
    const url = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${targetUrl}`;

    let html = "";
    try {
      // We still use our retry wrapper! ScraperAPI can sometimes be slow.
      const response = await fetchWithRetry(url, 3, 2000); 
      html = await response.text();
    } catch (fetchError) {
      console.error('[Telebirr Fetch Error via Scraper]', fetchError);
      res.status(503).json({ error: 'Telecom servers are currently unreachable. Please try verifying again.' });
      return;
    }

    if (!html || html.includes('No Data Found') || html.includes('Invalid')) {
      res.status(404).json({ error: 'Invalid Transaction ID. Receipt not found.' });
      return;
    }

    // 3. 🔍 VALIDATION LOGIC
    // A. Verify Recipient
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
    
    // 🚨 TEST MODE: Explicitly allow your specific 3000 Birr CBE receipt
    const isTestReceipt = transactionId === 'DD11G33YDR' && html.includes('3000.00');

    // The receipt formats exactly like "149.00 Birr". We search the raw HTML.
    if (!html.includes(`${expectedAmount}.00`) && !isTestReceipt) {
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
    res.status(500).json({ error: 'Servers are currently unreachable. Please try verifying again in a minute.' });
  }
};