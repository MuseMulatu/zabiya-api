import TelegramBot from 'node-telegram-bot-api';

const token = process.env.NEST_JUNIOR_BOT_TOKEN;

export const nestBot = token ? new TelegramBot(token, { polling: true }) : null;

// Map to store phone numbers linked to their active Telegram Chat ID
export const phoneToChatIdStore = new Map<string, number>();

if (nestBot) {
    console.log('🤖 Nest Junior Telegram Bot is actively listening...');

    // Welcome message when they press start
    nestBot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        
        nestBot.sendMessage(chatId, "👋 Welcome to Nest Junior! To securely receive your login OTP, please share your phone number using the button below.", {
            reply_markup: {
                keyboard: [
                    [{ text: "📱 Share Phone Number", request_contact: true }]
                ],
                resize_keyboard: true,
                one_time_keyboard: true
            }
        });
    });

    // Capture the contact object when shared
    nestBot.on('contact', (msg) => {
        const chatId = msg.chat.id;
        let rawPhone = msg.contact?.phone_number || '';
        
        // Clean phone format to standard digits (removing +, spaces etc.)
        const cleanPhone = rawPhone.replace(/\D/g, '');
        // Normalize Ethiopian format from 2519... to standard local 09... if necessary
        const standardPhone = cleanPhone.startsWith('251') ? '0' + cleanPhone.slice(3) : cleanPhone;

        // Save the verified mapping to memory
        phoneToChatIdStore.set(standardPhone, chatId);

        nestBot.sendMessage(chatId, "✅ Phone number linked successfully! You can now return to the app and request your secure OTP code.", {
            reply_markup: { remove_keyboard: true }
        });
    });
}