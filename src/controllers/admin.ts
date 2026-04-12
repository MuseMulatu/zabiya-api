import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/db/prisma';
import { decryptData } from '../lib/encryption';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET as string;

// 🛡️ SHOCK ABSORBER: Safely attempt decryption without crashing the loop
const safeDecrypt = (encryptedString: string | null | undefined, fallback: string): string => {
  if (!encryptedString) return fallback; // Catch nulls from legacy users
  try {
    const result = decryptData(encryptedString);
    return result ? result : fallback; // Catch if decryptData returns null
  } catch (error) {
    return 'Decryption Error'; // Catch corrupted strings
  }
};

// 1. ADMIN LOGIN
export const adminLogin = async (req: Request, res: Response): Promise<void> => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  // Issue a special admin token
  const token = jwt.sign({ role: 'god_mode' }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ success: true, token });
};

// 2. ADMIN DASHBOARD STATS
export const getAdminStats = async (req: Request, res: Response): Promise<void> => {
  try {
    // Basic Counts
    const totalUsers = await prisma.user.count();
    const totalMatches = await prisma.match.count();
    const totalAliases = await prisma.alias.count();

    // Revenue & Purchases (Only counting SUCCESSful transactions)
    const transactions = await prisma.transaction.findMany({ where: { status: 'SUCCESS' } });
    const totalRevenue = transactions.reduce((sum, tx) => sum + tx.amount, 0);
    const basicPurchases = transactions.filter(tx => tx.package_type === 'basic').length;
    const premiumPurchases = transactions.filter(tx => tx.package_type === 'premium').length;

    // Leaderboard: Top Matched Users (Calculated in-memory for simplicity)
    const usersWithMatches = await prisma.user.findMany({
      include: {
        _count: { select: { matches_a: true, matches_b: true } }
      }
    });

    const leaderboard = usersWithMatches
      .map(u => ({
        id: u.id,
        phone: u.phone_encrypted ? decryptData(u.phone_encrypted) : 'Unknown',
        total_matches: u._count.matches_a + u._count.matches_b
      }))
      .sort((a, b) => b.total_matches - a.total_matches)
      .slice(0, 10); // Top 10

    res.json({
      success: true,
      stats: { totalUsers, totalMatches, totalAliases, totalRevenue, basicPurchases, premiumPurchases },
      leaderboard,
      recentTransactions: transactions.slice(-10).reverse() // Last 10 payments
    });
  } catch (error) {
    res.status(500).json({ error: 'Admin stats failed' });
  }
};

// 3. GET ALL USERS (For the table)
export const getAllUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      include: { wallet: true, _count: { select: { aliases: true, intents: true } } },
      orderBy: { created_at: 'desc' }
    });

   const decryptedUsers = users.map(u => ({
      id: u.id,
      phone: safeDecrypt(u.phone_encrypted, 'Missing'),
      telegram: safeDecrypt(u.telegram_username_enc, 'None'),
      slots: u.wallet?.slots_balance || 0,
      alias_count: u._count.aliases,
      intent_count: u._count.intents,
      joined: u.created_at
    }));

    res.json({ success: true, users: decryptedUsers });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
};

// 4. GET USER DETAILS
    export const getUserDetails = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string; // ✅ We force it to be a string!
    
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        wallet: true,
        aliases: true,
        intents: true,
        transactions: true,
        matches_a: { include: { user_b: true } },
        matches_b: { include: { user_a: true } }
      }
    });

    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

res.json({
      success: true,
      user: {
        id: user.id,
        phone: safeDecrypt(user.phone_encrypted, 'Missing'),
        telegram: safeDecrypt(user.telegram_username_enc, 'None'),
        slots: user.wallet?.slots_balance || 0,
        aliases: user.aliases.map(a => ({ 
          type: a.type, 
          value: safeDecrypt(a.encrypted_value, 'Hash Only') 
        })),
        intents: user.intents,
        transactions: user.transactions,
        total_matches: user.matches_a.length + user.matches_b.length
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user details' });
  }
};