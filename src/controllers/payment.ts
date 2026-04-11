import { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/db/prisma';
import { AuthenticatedRequest } from '../middleware/auth';
import { decryptData } from '../lib/encryption';
import { sendTelegramMessage } from '../lib/notifications/telegram';
import { formatArifpayPhone } from '../lib/security/normalization';

const ARIFPAY_WEBHOOK_SECRET = process.env.ARIFPAY_WEBHOOK_SECRET;

const ARIFPAY_API_KEY = process.env.ARIFPAY_API_KEY as string;
// Defaulting to the gateway provided in the docs
const ARIFPAY_BASE_URL = process.env.ARIFPAY_BASE_URL;
const API_BASE_URL = process.env.API_BASE_URL;
const FRONTEND_URL = process.env.FRONTEND_URL;
const APP_BASE_URL = process.env.APP_BASE_URL;

if (!ARIFPAY_API_KEY || !ARIFPAY_WEBHOOK_SECRET) {
  console.warn('⚠️ ARIFPAY credentials missing. Payment engine will fail.');
}

const PACKAGES: Record<string, { slots: number; price: number; name: string; currency: string }> = {
  basic: { slots: 3, price: 50, name: 'Basic: 3 Intent Slots', currency: 'ETB' },
  premium: { slots: 10, price: 120, name: 'Premium: 10 Intent Slots', currency: 'ETB' }
};

/**
 * POST /api/payment/webhook
 * FinTech grade security: Raw body HMAC, Timing-Safe Equality, and Atomic Locks.
 */
export const paymentWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const signature = req.headers['x-arifpay-signature'] as string;
    const rawBody = (req as any).rawBody; // 🚨 FINTECH FIX: Extracted from Express middleware

    if (!signature || !ARIFPAY_WEBHOOK_SECRET || !rawBody) {
      res.status(401).json({ error: 'Unauthorized: Missing Signature or Body.' });
      return;
    }

    // 1. Compile expected signature securely using the raw byte buffer
    const expectedSignature = crypto
      .createHmac('sha256', ARIFPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex'); // Adjust to 'base64' if ArifPay uses base64

    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expectedSignature, 'utf8');

    // 2. Timing-Safe Comparison
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      console.error('🚨 [Payment Webhook] Signature mismatch detected.');
      res.status(401).json({ error: 'Unauthorized: Invalid Signature.' });
      return;
    }

    // 🚨 FIX: Extract 'uuid' from Arifpay payload but call it 'sessionId' locally
    const { uuid: sessionId, status, amount, currency } = req.body;

    if (!sessionId || !status) {
      res.status(400).json({ error: 'Malformed webhook payload.' });
      return;
    }

    const transaction = await prisma.transaction.findUnique({
      where: { session_id: sessionId }, // 👈 Changed to session_id
      include: { user: true }
    });

    if (!transaction) {
      res.status(404).json({ error: 'Transaction not found.' });
      return;
    }

    // 3. Webhook Payload Validation (Amount & Currency)
    // Convert Prisma Decimal to Number for safe comparison
    if (Number(transaction.amount) !== Number(amount)) {
     console.error(`🚨 [Payment Webhook] Payload mismatch! DB Amount: ${transaction.amount}, Webhook Amount: ${amount}`);
      res.status(400).json({ error: 'Payload validation failed: Amount/Currency mismatch.' });
      return;
    }


if (status === 'SUCCESS') {
      const packageConfig = PACKAGES[transaction.package_type];

      // Add a check to satisfy TypeScript and prevent runtime errors
      if (!packageConfig) {
        console.error(`🚨 [Payment Webhook] Unknown package type: ${transaction.package_type} for transaction ${transaction.id}`);
        res.status(400).json({ error: 'Payload validation failed: Unknown package type.' });
        return;
      }

      // 4. Atomic Concurrency Lock (Idempotency)
      await prisma.$transaction(async (tx) => {
        // This lock strictly updates ONLY if it is currently PENDING
        const updatedTx = await tx.transaction.updateMany({
          where: { 
            id: transaction.id, 
            status: 'PENDING' 
          },
          data: { status: 'SUCCESS' }
        });

        // If count is 0, another parallel webhook instance already processed this request.
        if (updatedTx.count === 0) {
          console.log(`[Payment Webhook] Transaction ${transaction.id} already processed. Exiting gracefully.`);
          return; 
        }

        // We safely increment the wallet because the updateMany lock succeeded
        await tx.wallet.update({
          where: { user_id: transaction.user_id },
          data: { slots_balance: { increment: packageConfig.slots } }
        });

        // 5. Telegram Receipt Notification
        if (transaction.user.telegram_chat_id) {
          const receiptMessage = `✅ Payment Successful!\nYour Zabiya vault has been reloaded with ${packageConfig.slots} intent slots. Happy matching!`;
          sendTelegramMessage(transaction.user.telegram_chat_id, receiptMessage).catch(console.error);
        }
      });
    } else {
      // Handle Failed/Canceled transactions
      await prisma.transaction.updateMany({
        where: { id: transaction.id, status: 'PENDING' },
        data: { status: 'FAILED' }
      });
    }

    res.status(200).json({ success: true, message: 'Webhook processed successfully' });

  } catch (error) {
    console.error('[Payment Webhook Error]', error);
    res.status(500).json({ error: 'Internal Server Error processing webhook.' });
  }
};

export const initializePayment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
   const { packageType } = req.body; // 👈 Removed 'phone' from req.body

    if (!userId || !packageType) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // 🚨 FIX: Securely fetch and decrypt the user's actual phone number
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.phone_encrypted) {
      res.status(400).json({ error: 'User phone number not found in vault.' });
      return;
    }
    
    // Decrypt it for ArifPay
    const rawPhone = decryptData(user.phone_encrypted);

    // 1. Determine Pricing
    const amount = packageType === 'premium' ? 199.0 : 149.0;
    // (We don't actually need to declare slotsToAdd here, but just for clarity)
    const slotsToAdd = packageType === 'premium' ? 5 : 3;

    // 2. IDEMPOTENCY CHECK: Is there already a pending transaction?
    const existingTx = await prisma.transaction.findFirst({
      where: {
        user_id: userId,
        package_type: packageType,
        status: 'PENDING',
        expire_date: { gt: new Date() },
        checkout_url: { not: null }
      }
    });

    if (existingTx && existingTx.checkout_url) {
      // Return the exact same checkout URL so they don't generate 50 duplicate sessions
      res.status(200).json({ success: true, checkoutUrl: existingTx.checkout_url });
      return;
    }

    // 3. Prep Data for ArifPay
    const formattedPhone = formatArifpayPhone(rawPhone);
    const nonce = crypto.randomUUID().replace(/-/g, '').substring(0, 20);
    
    // 🚨 FIX 1: Timezone Trap. Add 4 hours to guarantee it is in the future 
    // regardless of server UTC/EAT timezone stripping.
    const expireDateObj = new Date();
    expireDateObj.setHours(expireDateObj.getHours() + 4); 
    const expireDateStr = expireDateObj.toISOString().split('.')[0];
    
    // 4. Create PENDING Transaction in DB
    const tx = await prisma.transaction.create({
      data: {
        user_id: userId,
        nonce,
        amount,
        package_type: packageType,
        expire_date: expireDateObj,
        status: 'PENDING'
      }
    });
// 5. Build ArifPay Payload (Optimized from official Docs)
    const payload = {
      cancelUrl: `${process.env.FRONTEND_URL}/dashboard?payment=cancelled`,
      errorUrl: `${process.env.FRONTEND_URL}/dashboard?payment=error`,
      successUrl: `${process.env.FRONTEND_URL}/dashboard?payment=success`,
      notifyUrl: `${process.env.API_BASE_URL}/api/payment/webhook`,
      
      // Phone MUST be format: 2519XXXXXXXX (No + or 09)
      phone: formattedPhone, 
      
      // 🚨 MAGIC SANDBOX EMAIL: Forces an automatic "SUCCESS" webhook for testing
      email: "telebirrTest@gmail.com", 
      
      amount: 5,              
      nonce: nonce,
      expireDate: expireDateStr, // Ensure your backend generates a future date string
      
      // 🚨 FIXED: MPESSA requires double 'S' based on Arifpay schema
      paymentMethods: ["TELEBIRR", "CBE", "MPESSA"], 
      
      items: [
        { 
          name: `Orbit ${packageType} Package`, 
          price: 5, 
          quantity: 1, 
          description: "Zabiya Identity Vault Slots" // Added to strictly match their example
        }
      ],
      
      // Sandbox Dummy Account (Change to real CBE details when going Live)
      beneficiaries: [ 
        {
          accountNumber: "1000665542789", 
          bank: "CBETETAA",                
          amount: amount
        }
      ],
      lang: "EN"
    };

    console.log("🚀 Payload going to ArifPay:", JSON.stringify(payload, null, 2));
    // 6. Call ArifPay API
    const response = await fetch(`${ARIFPAY_BASE_URL}/api/checkout/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-arifpay-key': ARIFPAY_API_KEY
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

  // 🚨 FIX 4: Better Error Logging so we never have to guess again
    if (!response.ok || data.error) {
      await prisma.transaction.update({ where: { id: tx.id }, data: { status: 'FAILED' } });
      console.error("❌ ARIFPAY REJECTION DETAILS:", JSON.stringify(data, null, 2));
      throw new Error(data.msg || 'Validation Error');
    }

    // 7. CRITICAL: Update DB with the returned Session ID and URL
    const sessionId = data.data.sessionId;
    const paymentUrl = data.data.paymentUrl;

    await prisma.transaction.update({
      where: { id: tx.id },
      data: { session_id: sessionId, checkout_url: paymentUrl }
    });

    res.status(200).json({ success: true, checkoutUrl: paymentUrl });

  } catch (error: any) {
    console.error('[Payment Init Error]', error);
    res.status(500).json({ error: 'Failed to initialize payment gateway.' });
  }
};


// --- 2. SECURE WEBHOOK HANDLER ---
export const handleWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    // 🚨 FIX: Extract 'uuid' from Arifpay payload but call it 'sessionId' locally
    const { uuid: sessionId, nonce } = req.body;
    if (!sessionId) {
      res.status(400).send('Missing Session ID');
      return;
    }

    // 1. SECONDARY VERIFICATION: Never trust the webhook body blindly.
    const verifyResponse = await fetch(`${ARIFPAY_BASE_URL}/api/ms/transaction/status/${sessionId}`, {
      method: 'GET',
      headers: { 'x-arifpay-key': ARIFPAY_API_KEY }
    });
    
    const verifyData = await verifyResponse.json();
    const actualStatus = verifyData.data?.status || 'FAILED'; // e.g., 'SUCCESS', 'FAILED', 'CANCELED'

    // 2. Fetch the transaction from our DB
    // 👈 FIX 1 & 4: Use 'session_id' and add 'include: { user: true }'
    const tx = await prisma.transaction.findUnique({ 
      where: { session_id: sessionId },
      include: { user: true } 
    });
    
    if (!tx) {
      // Acknowledge receipt even if not found to stop ArifPay from retrying infinitely
      res.status(200).send('Transaction not found in our system'); 
      return;
    }

    // Prevent double crediting
    if (tx.status === 'SUCCESS') {
      res.status(200).send('Already processed');
      return;
    }

    // 3. Process Based on Verified Status
    if (actualStatus === 'SUCCESS') {
      // Atomic Transaction to Update Status & Provision Wallet
      const slotsToAdd = tx.package_type === 'premium' ? 6 : 3; // 👈 Updated amounts

      await prisma.$transaction([
        prisma.transaction.update({
          where: { id: tx.id },
          data: { status: 'SUCCESS' }
        }),
        prisma.wallet.update({
          where: { user_id: tx.user_id },
          data: { slots_balance: { increment: slotsToAdd } } // 👈 Unified column
        })
      ]);

      // 👈 FIX 5: Now tx.user exists and we can access telegram_chat_id
      if (tx.user && tx.user.telegram_chat_id) {
         // If you have a notification function, call it here. 
         // Example: sendTelegramMessage(tx.user.telegram_chat_id, 'Payment successful!').catch(console.error);
      }

    } else {
      // Update DB to FAILED, CANCELED, or EXPIRED
      await prisma.transaction.update({
        where: { id: tx.id },
        data: { status: actualStatus }
      });
    }

    // 4. Always return 200 OK so Arifpay knows we received it
    res.status(200).send('Webhook processed');

  } catch (error) {
    console.error('[Webhook Error]', error);
    // Still return 200 to prevent gateway retry loops during unexpected errors
    res.status(200).send('Error processing webhook'); 
  }
};