import TelegramBot from 'node-telegram-bot-api';
import { prisma } from '../db/prisma';
// Import the normalizer at the top of the file
import { normalizePhoneNumber } from '../security/normalization';

const token = process.env.NEST_JUNIOR_TELEGRAM_BOT_TOKEN || '';

export const nestBot = new TelegramBot(token, { polling: false });

export const initNestJuniorBot = async () => {
    try {
        if (!token) return console.warn("⚠️ Telegram token missing!");
        const webhookUrl = `${process.env.PUBLIC_URL || 'https://api.zabiya.com'}/api/nest-junior/webhook`;
        
        await nestBot.setWebHook(webhookUrl);
        console.log(`🤖 Nest Junior Webhook successfully locked onto ${webhookUrl}`);
    } catch (error) {
        console.error("❌ Fatal Error Setting Telegram Webhook:", error);
    }
};
export const handleNestJuniorWebhook = async (req: any, res: any) => {

    // 🚨 Log immediately before doing anything else
    console.log("👉 Nest Junior Webhook Hit!");

    console.log("=========================================");
    console.log("🚨 TELEGRAM WEBHOOK HIT!");
    console.log("Headers:", req.headers);
    console.log("Body:", JSON.stringify(req.body, null, 2));
    console.log("=========================================");
    
    // Instantly respond to Telegram so they don't timeout and throw 502s
    res.sendStatus(200); 
    
    // Use optional chaining (?) to prevent fatal server crashes
    const message = req.body?.message; 
    if (!message) return;

    const chatId = message.chat?.id?.toString();
    if (!chatId) return;

    try {
      // --- PHASE A: THE /START COMMAND ---
        if (message.text && message.text.startsWith('/start')) {
            const rolePayload = message.text.split(' ')[1]; 
            
            let greetingText = 'Welcome to Nest Junior! 🛡️';
            if (rolePayload === 'driver') greetingText = 'Welcome to the CareDriver Portal! 🚖';
            if (rolePayload === 'parent') greetingText = 'Welcome to the Nest Junior Parent Portal! 👨‍👩‍👧';

            await nestBot.sendMessage(chatId, `${greetingText}\n\nPlease tap the button below to securely verify your phone number.`, {
                reply_markup: {
                    keyboard: [[{ text: "📱 Share Contact to Verify", request_contact: true }]],
                    resize_keyboard: true,
                    one_time_keyboard: true
                }
            });
            return; 
        }

        // --- PHASE B: THE CONTACT SHARE & OTP DELIVERY ---
        if (message.contact) {
            console.log("\n--- [TELEGRAM BOT] CONTACT RECEIVED ---");
            const rawPhoneNumber = message.contact.phone_number;
            console.log(`1. Raw Phone from Telegram: "${rawPhoneNumber}"`);
            
            const safePhone = normalizePhoneNumber(rawPhoneNumber);
            console.log(`2. Normalized Phone (Querying DB): "${safePhone}"`);

            const pendingOtp = await prisma.otpRequest.findUnique({ 
                where: { phone: safePhone } 
            });

            if (!pendingOtp) {
                console.log(`❌ ERROR: DB lookup failed. No OTP staged for "${safePhone}"`);
                await nestBot.sendMessage(chatId, "⚠️ We couldn't find a pending request for this number. Please open the app and click 'Request OTP' first.", {
                    reply_markup: { remove_keyboard: true }
                });
                return;
            }

            console.log(`3. SUCCESS! Found OTP in DB. Sending "${pendingOtp.otp_code}" to Telegram user.`);
            await nestBot.sendMessage(chatId, `🔒 Your Nest Junior Auth Code is:\n\n\`${pendingOtp.otp_code}\`\n\nTap the code to copy it, then paste it back into the app.`, {
                parse_mode: 'Markdown',
                reply_markup: { remove_keyboard: true }
            });
        }
    } catch (error) {
        console.error("Nest Junior Webhook Error:", error);
    }
};