import { prisma } from '../db/prisma';
import { sendTelegramMessage } from './telegram'; // Must return a boolean!

/**
 * Evaluates the target of a new crush and determines if an anonymous 
 * notification should be sent based on gender, velocity, and wallet balance.
 */
export const triggerCrushNotification = async (targetHash: string): Promise<void> => {
  try {
    // 1. Obfuscation Delay (CRITICAL PRIVACY)
    // Delays execution randomly between 15 minutes and 2 hours
    await new Promise(res => setTimeout(res, Math.floor(Math.random() * (7200000 - 900000 + 1) + 900000)));

    // 2. Identify Target User & Wallet
    const targetAlias = await prisma.alias.findFirst({
      where: { hashed_value: targetHash, verified: true },
      include: { 
        user: { include: { wallet: true } } 
      },
    });

    if (!targetAlias || !targetAlias.user.telegram_chat_id) return;
    const userB = targetAlias.user;

    // 3. The Zero-Slot UX Check
    if (!userB.wallet || userB.wallet.slots_balance < 1) {
      console.log(`[Notification Engine] Muted crush notification for user ${userB.id} (Zero slots)`);
      return;
    }

    // 4. Calculate Inbound Velocity (Distinct users in the last 14 days)
    const allUserAliases = await prisma.alias.findMany({
      where: { user_id: userB.id, verified: true },
      select: { hashed_value: true },
    });
    
    const userBAliasHashes = allUserAliases.map(a => a.hashed_value);
    
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const recentIntents = await prisma.intent.findMany({
      where: { 
        target_hash: { in: userBAliasHashes },
        created_at: { gte: fourteenDaysAgo }
      },
      distinct: ['user_id'],
      select: { user_id: true }
    });

    const inboundCount = recentIntents.length;
    const notificationMessage = "Someone has you in their Zabiya vault. Add your crushes to see if it’s mutual.";

    let shouldSend = false;

    // The Smart Throttle Logic
    if (userB.gender === 'male' || !userB.gender) {
      shouldSend = true;
    } else if (userB.gender === 'female' && inboundCount <= 2) {
      shouldSend = true;
    }

    // 5. Dispatch & Atomic Concurrency Handling
    if (shouldSend) {
      const twentyFourHoursAgo = new Date();
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

      // Fast exit if memory already shows a recent notification
      if (userB.last_notified_at && userB.last_notified_at > twentyFourHoursAgo) {
        return; 
      }

      // Fire to Telegram first
      const success = await sendTelegramMessage(userB.telegram_chat_id as string, notificationMessage);

      // Only update the database if Telegram accepted the message
      if (success) {
        // Atomic Update: Catch race conditions from duplicate simultaneous intents
        const updated = await prisma.user.updateMany({
          where: {
            id: userB.id,
            OR: [
              { last_notified_at: null },
              { last_notified_at: { lt: twentyFourHoursAgo } }
            ]
          },
          data: { last_notified_at: new Date() }
        });

        if (updated.count === 0) {
          console.log(`[Notification Engine] Muted crush notification for user ${userB.id} (Atomic lock caught parallel execution)`);
          return;
        }
      }
    } else {
      console.log(`[Notification Engine] Muted crush notification for female user ${userB.id} (Inbound limit > 2)`);
    }

  } catch (error) {
    console.error('[Notification Engine Error] Crush Throttle Failed:', error);
  }
};

/**
 * Triggers when a mutual match is successfully created.
 */
export const triggerMatchNotification = async (userAChatId: string, userBChatId: string): Promise<void> => {
  const matchMessage = "Mutual intent confirmed! 💖 You have a new match on Zabiya. Log in to see who.";
  
  await Promise.all([
    sendTelegramMessage(userAChatId, matchMessage),
    sendTelegramMessage(userBChatId, matchMessage)
  ]);
};