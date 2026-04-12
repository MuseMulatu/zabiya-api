// Ensure your environment variable is loaded in your entry point
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TELEGRAM_BOT_TOKEN) {
  console.warn('⚠️ TELEGRAM_BOT_TOKEN is missing. Notifications will be silently disabled.');
}

/**
 * Sends a standard text message to a user via the Telegram Bot API.
 * * @param chatId The Telegram Chat ID of the user.
 * @param message The text message to send.
 * @returns {Promise<boolean>} True if the message was successfully delivered, false otherwise.
 */
export const sendTelegramMessage = async (chatId: string, message: string): Promise<boolean> => {
  // Fail safely if credentials or target are missing
  if (!TELEGRAM_BOT_TOKEN || !chatId) {
    return false;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "MarkdownV2
        // parse_mode: 'HTML' // Uncomment this if you want to use bold/italics in your messages later!
      }),
    });

    // Check if Telegram accepted the request
    if (!response.ok) {
      const errorData = await response.json();
      console.error('[Telegram API Error]', errorData);
      return false; // Tells the caller (engine.ts) NOT to update the database lock
    }

    return true; // Success! The caller can now safely lock the notification state

  } catch (error) {
    // This catches network failures (e.g., DNS issues, server offline)
    console.error('[Telegram Fetch Error] Failed to send notification:', error);
    return false;
  }
};