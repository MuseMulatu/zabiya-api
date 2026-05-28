import TelegramBot from 'node-telegram-bot-api';

// Grab the token from your .env file
const token = process.env.NEST_JUNIOR_BOT_TOKEN;

// Initialize the bot with polling enabled so it actively listens for messages
export const nestBot = token ? new TelegramBot(token, { polling: true }) : null;

// Temporary memory store to hold the parent's chat_id until they finish registration
export const tempChatIdStore = new Map<string, number>();

if (nestBot) {
    console.log('🤖 Nest Junior Telegram Bot is actively listening...');

    // This listens specifically for the /start command followed by the firebaseUid
    nestBot.onText(/\/start (.+)/, (msg, match) => {
        const chatId = msg.chat.id;
        // The firebaseUid is passed from the deep link in your React Native app
        const firebaseUid = match ? match[1] : null;

        if (firebaseUid) {
            // Save the chat_id in memory linked to their Firebase UID
            tempChatIdStore.set(firebaseUid, chatId);
            
            nestBot.sendMessage(
                chatId, 
                "👋 Welcome to Nest Junior! You are now connected. Please return to the app to request your OTP."
            );
        } else {
            nestBot.sendMessage(
                chatId, 
                "Welcome! Please initiate this bot directly from the registration link inside the Nest Junior app."
            );
        }
    });
} else {
    console.warn('⚠️ NEST_JUNIOR_BOT_TOKEN is missing from .env');
}