import TelegramBot from 'node-telegram-bot-api';

const token = process.env.NEST_JUNIOR_BOT_TOKEN;

// 1. Initialize WITHOUT polling
export const nestBot = token ? new TelegramBot(token, { polling: false }) : null;

export const phoneToChatIdStore = new Map<string, number>();

if (nestBot) {
    console.log('🤖 Nest Junior Telegram Webhook Router Initialized.');

    // Welcome command handler
    nestBot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        nestBot.sendMessage(chatId, "👋 Welcome to Nest Junior! Please share your phone number using the button below to receive your OTP.", {
            reply_markup: {
                keyboard: [[{ text: "📱 Share Phone Number", request_contact: true }]],
                resize_keyboard: true,
                one_time_keyboard: true
            }
        });
    });

    // Contact sharing handler
    nestBot.on('contact', (msg) => {
        const chatId = msg.chat.id;
        const rawPhone = msg.contact?.phone_number || '';
        const cleanPhone = rawPhone.replace(/\D/g, '');
        const standardPhone = cleanPhone.startsWith('251') ? '0' + cleanPhone.slice(3) : cleanPhone;

        phoneToChatIdStore.set(standardPhone, chatId);

        nestBot.sendMessage(chatId, "✅ Connected! Return to the app to request your OTP.", {
            reply_markup: { remove_keyboard: true }
        });
    });
}