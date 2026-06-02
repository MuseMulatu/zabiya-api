import TelegramBot from 'node-telegram-bot-api';
import { prisma } from '../db/prisma';

const token = process.env.NEST_JUNIOR_TELEGRAM_BOT_TOKEN || '';

// 1. NO POLLING! Strict Webhook mode.
export const nestBot = new TelegramBot(token, { polling: false });

export const initNestJuniorBot = async () => {
    if (!token) return console.warn("⚠️ Telegram token missing!");

    // 2. Point Telegram to your Express Webhook Route
    const webhookUrl = `${process.env.PUBLIC_URL || 'https://api.zabiya.com'}/api/nest-junior/webhook`;
    await nestBot.setWebHook(webhookUrl);
    
    console.log(`🤖 Nest Junior Webhook locked onto ${webhookUrl}`);
};

// 3. The Interception Logic
export const handleNestJuniorWebhook = async (req: any, res: any) => {
    res.sendStatus(200); // Instantly tell Telegram we received it
    
    const message = req.body.message;
    if (!message) return;

    const chatId = message.chat.id.toString();

    try {
        // --- PHASE A: THE DEEP LINK (/start driver or /start parent) ---
        if (message.text && message.text.startsWith('/start')) {
            const rolePayload = message.text.split(' ')[1]; // Extracts 'driver' or 'parent'
            
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
            // Telegram usually sends "251911..." or "+251911...". We normalize it to "0911..." to match your DB.
            let phone = message.contact.phone_number.replace(/\D/g, ''); 
            if (phone.startsWith('251')) {
                phone = '0' + phone.substring(3);
            }

            // Look up the OTP staged by the frontend
            const pendingOtp = await prisma.otpRequest.findUnique({ where: { phone } });

            if (!pendingOtp) {
                await nestBot.sendMessage(chatId, "⚠️ We couldn't find a pending request for this number. Please open the app and click 'Request OTP' first.", {
                    reply_markup: { remove_keyboard: true }
                });
                return;
            }

            // Deliver the Payload with tap-to-copy backticks!
            await nestBot.sendMessage(chatId, `🔒 Your Nest Junior Auth Code is:\n\n\`${pendingOtp.otp_code}\`\n\nTap the code to copy it, then paste it back into the app.`, {
                parse_mode: 'Markdown',
                reply_markup: { remove_keyboard: true } // Remove the contact button
            });
        }
    } catch (error) {
        console.error("Nest Junior Webhook Error:", error);
    }
};