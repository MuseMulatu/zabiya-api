import { Response } from 'express';
import { prisma } from '../lib/db/prisma';
import { AuthenticatedRequest } from '../middleware/auth';
import { hashIdentifier, AliasType } from '../lib/hashing'; 
import { triggerCrushNotification, triggerMatchNotification } from '../lib/notifications/engine';
import { decryptData, encryptData } from '../lib/encryption';
import { normalizeIdentifier } from '../lib/security/normalization';

// ==========================================
// 🛡️ SHOCK ABSORBER FUNCTION
// Safely attempt decryption without crashing the server
// ==========================================
const safeDecrypt = (encryptedString: string | null | undefined, fallback: string): string => {
  if (!encryptedString) return fallback; 
  try {
    const result = decryptData(encryptedString);
    return result ? result : fallback; 
  } catch (error) {
    return fallback; // Return fallback silently instead of crashing
  }
};

// --- HELPER: Age Calculation ---
const calculateAge = (birthDate: Date): number => {
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
};

// --- HELPER: Age Firewall Logic ---
const passesAgeFirewall = (birthDateA: Date | null, birthDateB: Date | null): boolean => {
  if (!birthDateA || !birthDateB) return false;

  const ageA = calculateAge(birthDateA);
  const ageB = calculateAge(birthDateB);

  if (ageA >= 18 && ageB >= 18) return true;

  const ageGap = Math.abs(ageA - ageB);
  return ageGap <= 2;
};

// --- 1. REVOKE INTENT (Audit-Safe) ---
export const revokeIntent = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const intentId = req.params.id as string; 

    if (!userId || !intentId) {
      res.status(400).json({ error: 'Missing user or intent ID.' });
      return;
    }

    const intent = await prisma.intent.findUnique({ where: { id: intentId } });
    if (!intent || intent.user_id !== userId) {
      res.status(404).json({ error: 'Intent not found' }); 
      return;
    }

    await prisma.intent.update({
      where: { id: intentId },
      data: { status: 'REVOKED' }
    });

    res.status(200).json({ success: true, message: 'Intent securely revoked.' });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// --- 2. BLOCK MATCH ---
export const blockMatch = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { matchId } = req.body;
    if (!userId) return;

    const match = await prisma.match.findUnique({ where: { id: matchId } });
    if (!match || (match.user_a_id !== userId && match.user_b_id !== userId)) {
      res.status(404).json({ error: 'Match not found' }); return;
    }

    const otherUserId = match.user_a_id === userId ? match.user_b_id : match.user_a_id;

    await prisma.$transaction(async (tx) => {
      await tx.match.update({
        where: { id: matchId },
        data: { status: 'BLOCKED' }
      });
      await tx.block.upsert({
        where: { blocker_id_blocked_id: { blocker_id: userId, blocked_id: otherUserId } },
        update: {},
        create: { blocker_id: userId, blocked_id: otherUserId }
      });
    });

    res.status(200).json({ success: true, message: 'Connection severed.' });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// --- 3. UNBLOCK CONNECTION ---
export const unblockUser = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const { blockId } = req.body;
    if (!userId) return;

    const blockRecord = await prisma.block.findUnique({ where: { id: blockId } });
    if (!blockRecord || blockRecord.blocker_id !== userId) {
      res.status(404).json({ error: 'Block record not found' }); return;
    }

    await prisma.block.delete({ where: { id: blockId } });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

// --- 4. ADD INTENT ---
export const addIntent = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { targetIdentifier, type } = req.body as { targetIdentifier: string, type: AliasType };

    const validTypes: AliasType[] = ['phone', 'telegram', 'instagram'];
    if (!type || !validTypes.includes(type)) {
      res.status(400).json({ error: "Invalid type. Must be 'phone', 'telegram', or 'instagram'." });
      return;
    }

    if (!targetIdentifier) {
      res.status(400).json({ error: 'Missing targetIdentifier.' });
      return;
    }

    const standardizedTarget = normalizeIdentifier(type, targetIdentifier);
    const targetHash = hashIdentifier(type, standardizedTarget);

    const result = await prisma.$transaction(async (tx) => {
      const userA = await tx.user.findUnique({
        where: { id: userId },
        include: { 
          wallet: true, 
          aliases: { where: { verified: true } } 
        }
      });

      if (!userA || !userA.wallet) throw new Error('USER_STATE_INVALID');

      const isTargetingSelf = userA.aliases.some(alias => alias.hashed_value === targetHash);
      if (isTargetingSelf) throw new Error('SELF_TARGETING');

      const existingIntent = await tx.intent.findFirst({
        where: { 
          user_id: userId, 
          target_hash: targetHash,
          status: 'ACTIVE',               
          expires_at: { gt: new Date() } 
        }
      });
      
      if (existingIntent) throw new Error('DUPLICATE_INTENT');

      if (userA.wallet.slots_balance < 1) throw new Error('INSUFFICIENT_FUNDS');

      await tx.wallet.update({
        where: { user_id: userId },
        data: { slots_balance: { decrement: 1 } }
      });

      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() + 30); 

      const encryptedTarget = encryptData(standardizedTarget);

      const intentA = await tx.intent.create({
        data: {
          user_id: userId,
          type: type,                          
          target_hash: targetHash,
          target_encrypted: encryptedTarget,   
          expires_at: expirationDate,
          status: 'ACTIVE'                     
        }
      });
      
      let transactionMatchFound = false;
      let userAChatId: string | undefined = undefined;
      let userBChatId: string | undefined = undefined;

      const targetAliasRecord = await tx.alias.findFirst({
        where: { hashed_value: targetHash, verified: true },
        include: { user: true }
      });

      if (targetAliasRecord) {
        const userB = targetAliasRecord.user;
        const userAAliasHashes = userA.aliases.map(a => a.hashed_value);

        const mutualIntent = await tx.intent.findFirst({
          where: {
            user_id: userB.id,
            target_hash: { in: userAAliasHashes },
            status: 'ACTIVE',
            expires_at: { gt: new Date() }
          }
        });

        if (mutualIntent && passesAgeFirewall(userA.birth_date, userB.birth_date)) {
          const existingMatch = await tx.match.findFirst({
            where: {
              OR: [
                { user_a_id: userA.id, user_b_id: userB.id },
                { user_a_id: userB.id, user_b_id: userA.id }
              ],
              status: 'ACTIVE'
            }
          });

          if (!existingMatch) {
            await tx.match.create({
              data: { user_a_id: userA.id, user_b_id: userB.id, status: 'ACTIVE' }
            });

            await tx.intent.updateMany({
              where: { id: { in: [intentA.id, mutualIntent.id] } },
              data: { status: 'REVOKED' }
            });

            transactionMatchFound = true;
            userAChatId = userA.telegram_chat_id || undefined;
            userBChatId = userB.telegram_chat_id || undefined;
          }
        }
      }

      return { matchFound: transactionMatchFound, userAChatId, userBChatId };
    }); 

    if (result.matchFound) {
      if (result.userAChatId && result.userBChatId) {
        triggerMatchNotification(result.userAChatId, result.userBChatId);
      }
    } else {
      triggerCrushNotification(targetHash);
    }

    res.status(200).json({ success: true, matchFound: result.matchFound });

  } catch (error: any) {
    if (error.message === 'USER_STATE_INVALID') {
      res.status(400).json({ error: 'User state is invalid.' });
    } else if (error.message === 'SELF_TARGETING') {
      res.status(400).json({ error: 'You cannot target yourself.' });
    } else if (error.message === 'DUPLICATE_INTENT') {
      res.status(400).json({ error: 'You already have an active intent for this target.' });
    } else if (error.message === 'INSUFFICIENT_FUNDS') {
      res.status(402).json({ error: 'Payment Required: Insufficient intent slots.' });
    } else {
      console.error('[Add Intent Error]', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
};

/**
 * GET /api/intent/dashboard
 */
export const getDashboard = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const rawAliases = await prisma.alias.findMany({ where: { user_id: userId } });
    
    // 🛡️ USE SAFE DECRYPT: Aliases
    const decryptedAliases = rawAliases.map(alias => {
      return {
        id: alias.id,
        type: alias.type,
        verified: alias.verified,
        created_at: alias.created_at,
        value: safeDecrypt(alias.encrypted_value, 'Hidden') // 👈 Safe
      };
    });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        wallet: true,
        aliases: { select: { id: true, type: true, verified: true, created_at: true } },
        _count: {
          select: { intents: { where: { expires_at: { gt: new Date() }, status: 'ACTIVE' } } }
        },
        matches_a: { where: { status: 'ACTIVE' }, include: { user_b: true } }, 
        matches_b: { where: { status: 'ACTIVE' }, include: { user_a: true } }  
      }
    });

    if (!user || !user.wallet) {
      res.status(404).json({ error: 'User data not found.' });
      return;
    }

    // 🚨 TELEGRAM UPSELL LOGIC
    let inactiveHandle = null;
    
    if (user.telegram_username_enc) {
      const decryptedMainHandle = safeDecrypt(user.telegram_username_enc, 'None'); // 👈 Safe
      
      if (decryptedMainHandle !== 'None') {
        const mainHandleAlreadyActive = decryptedAliases.some(
          a => a.type === 'telegram' && a.value === decryptedMainHandle && a.verified === true
        );
        
        if (!mainHandleAlreadyActive) {
          inactiveHandle = decryptedMainHandle;
        }
      }
    }

    // 🕵️‍♂️ MASSIVE DEBUG LOGGER
    console.log("\n=== 🕵️‍♂️ DASHBOARD PAYLOAD DEBUG ===");
    console.log("1. Raw DB Encrypted Username: ", user.telegram_username_enc);
    console.log("2. Decrypted Inactive Handle (Upsell): ", inactiveHandle);
    console.log("3. Current Vault Aliases: ", JSON.stringify(decryptedAliases, null, 2));
    console.log("====================================\n");

    const expiredIntents = await prisma.intent.findMany({
      where: {
        user_id: userId,
        expires_at: { lt: new Date() }
      },
      select: { id: true, target_hash: true, expires_at: true }
    });

    const rawActiveIntents = await prisma.intent.findMany({
      where: {
        user_id: userId,
        expires_at: { gt: new Date() }, 
        status: 'ACTIVE'
      },
      select: { id: true, type: true, target_encrypted: true, created_at: true },
      orderBy: { created_at: 'desc' }
    });

    // 🛡️ USE SAFE DECRYPT: Active Intents
    const activeIntents = rawActiveIntents.map(intent => ({
      id: intent.id,
      type: intent.type,
      target: safeDecrypt(intent.target_encrypted, 'Decryption Error'), // 👈 Safe
      created_at: intent.created_at
    }));

    const blockedRecords = await prisma.block.findMany({
      where: { blocker_id: userId },
      include: { blocked: true }
    });

    // 🛡️ USE SAFE DECRYPT: Blocked Connections
    const blockedConnections = blockedRecords.map(b => ({
      block_id: b.id,
      blocked_at: b.created_at,
      contact: {
        phone: safeDecrypt(b.blocked.phone_encrypted, 'Encrypted'), // 👈 Safe
        telegram_chat_id: b.blocked.telegram_chat_id
      }
    }));

    const processedMatches = [];
    
    // 🛡️ USE SAFE DECRYPT: Matches
    for (const match of user.matches_a) {
      processedMatches.push({
        match_id: match.id,
        matched_at: match.created_at,
        contact: {
          telegram_chat_id: match.user_b.telegram_chat_id,
          phone: safeDecrypt(match.user_b.phone_encrypted, 'Unknown'), // 👈 Safe
          gender: match.user_b.gender
        }
      });
    }

    for (const match of user.matches_b) {
      processedMatches.push({
        match_id: match.id,
        matched_at: match.created_at,
        contact: {
          telegram_chat_id: match.user_a.telegram_chat_id,
          phone: safeDecrypt(match.user_a.phone_encrypted, 'Unknown'), // 👈 Safe
          gender: match.user_a.gender
        }
      });
    }

    res.status(200).json({
      success: true,
      data: {
        wallet: { slots: user.wallet.slots_balance },
        aliases: decryptedAliases,
        inactive_telegram_handle: inactiveHandle, 
        active_intents_count: user._count.intents,
        active_intents: activeIntents, 
        expired_intents: expiredIntents,
        matches: processedMatches,
        blocked_connections: blockedConnections,
      }
    });

  } catch (error) {
    console.error('[Dashboard Error]', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};