const { Telegraf, Markup } = require('telegraf');
const express = require('express');

// Express server for Render health checks
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bilingual Anon Bot is running!'));
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

// Bot token from environment variables
const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('ERROR: BOT_TOKEN is missing!');
  process.exit(1);
}
const bot = new Telegraf(token);

// Multi-language strings
const STRINGS = {
  en: {
    welcome: '👋 Welcome to Anonymous Chat!\n\nPlease select your preferred language:',
    lang_changed: '✅ Language set to English!',
    find_btn: '🔎 Find Partner',
    skip_btn: '⏭️ Skip / Next',
    stop_btn: '🛑 End Chat',
    lang_btn: '🌐 भाषा बदलें (Hindi)',
    searching: '🔍 Searching for an English partner. Please wait...',
    connected: '🎉 Connected to a stranger! Say hi.\n(Tap "⏭️ Skip / Next" to find someone else)',
    disconnected: '❌ Stranger disconnected. Tap "🔎 Find Partner" to search again.',
    stopped: 'Chat ended. Tap "🔎 Find Partner" to start a new chat.',
    already_in: 'You are already in a chat! Tap "⏭️ Skip / Next" to switch.',
    not_in: 'You are not in a chat right now.',
    partner_dropped: 'Partner disconnected. Searching for a new match...'
  },
  hi: {
    welcome: '👋 अनाम चैट में आपका स्वागत है!\n\nकृपया अपनी पसंदीदा भाषा चुनें:',
    lang_changed: '✅ भाषा बदलकर हिंदी कर दी गई है!',
    find_btn: '🔎 पार्टनर ढूंढें',
    skip_btn: '⏭️ अगला / Skip',
    stop_btn: '🛑 चैट समाप्त करें',
    lang_btn: '🌐 Change Language (English)',
    searching: '🔍 हिंदी में बात करने के लिए पार्टनर ढूंढा जा रहा है। प्रतीक्षा करें...',
    connected: '🎉 आप एक अजनबी से जुड़ चुके हैं! नमस्ते बोलें।\n(बदलने के लिए "⏭️ अगला / Skip" दबाएं)',
    disconnected: '❌ सामने वाले ने चैट छोड़ दी। फिर खोजने के लिए "🔎 पार्टनर ढूंढें" दबाएं।',
    stopped: 'चैट समाप्त हो गई। नई बातचीत के लिए "🔎 पार्टनर ढूंढें" दबाएं।',
    already_in: 'आप पहले से चैट में हैं! नया पार्टनर ढूंढने के लिए "⏭️ अगला / Skip" दबाएं।',
    not_in: 'आप अभी किसी चैट में नहीं हैं।',
    partner_dropped: 'पार्टनर का संपर्क टूट गया। नया पार्टनर खोजा जा रहा है...'
  }
};

const userLanguages = new Map();
const activePairs = new Map();
const queues = { en: [], hi: [] };

function getLang(chatId) {
  return userLanguages.get(chatId) || 'en';
}

function makeKeyboard(lang) {
  const t = STRINGS[lang];
  return Markup.keyboard([
    [t.find_btn, t.skip_btn],
    [t.stop_btn, t.lang_btn]
  ]).resize();
}

const languagePicker = Markup.inlineKeyboard([
  [Markup.button.callback('🇬🇧 English', 'set_lang_en'), Markup.button.callback('🇮🇳 हिंदी', 'set_lang_hi')]
]);

async function endChat(chatId, notifyPartner = true) {
  const partnerId = activePairs.get(chatId);
  queues.en = queues.en.filter((id) => id !== chatId);
  queues.hi = queues.hi.filter((id) => id !== chatId);

  if (partnerId) {
    const partnerLang = getLang(partnerId);
    activePairs.delete(chatId);
    activePairs.delete(partnerId);

    if (notifyPartner) {
      try {
        await bot.telegram.sendMessage(partnerId, STRINGS[partnerLang].disconnected, makeKeyboard(partnerLang));
      } catch (err) {
        console.error('Notification failed:', err.message);
      }
    }
  }
}

async function matchUser(ctx) {
  const chatId = ctx.chat.id;
  const lang = getLang(chatId);
  const t = STRINGS[lang];

  if (activePairs.has(chatId)) return ctx.reply(t.already_in, makeKeyboard(lang));

  const queue = queues[lang];
  if (queue.includes(chatId)) return ctx.reply(t.searching, makeKeyboard(lang));

  const otherLang = lang === 'en' ? 'hi' : 'en';
  queues[otherLang] = queues[otherLang].filter((id) => id !== chatId);

  if (queue.length > 0) {
    const partnerId = queue.shift();
    if (partnerId === chatId) {
      queue.push(chatId);
      return ctx.reply(t.searching, makeKeyboard(lang));
    }

    activePairs.set(chatId, partnerId);
    activePairs.set(partnerId, chatId);
    const partnerLang = getLang(partnerId);

    await ctx.reply(STRINGS[lang].connected, makeKeyboard(lang));
    try {
      await bot.telegram.sendMessage(partnerId, STRINGS[partnerLang].connected, makeKeyboard(partnerLang));
    } catch (err) {
      activePairs.delete(chatId);
      activePairs.delete(partnerId);
      queue.push(chatId);
      return ctx.reply(t.partner_dropped, makeKeyboard(lang));
    }
  } else {
    queue.push(chatId);
    ctx.reply(t.searching, makeKeyboard(lang));
  }
}

bot.start((ctx) => {
  ctx.reply(`${STRINGS.en.welcome}\n\n${STRINGS.hi.welcome}`, languagePicker);
});

bot.action('set_lang_en', async (ctx) => {
  await ctx.answerCbQuery();
  userLanguages.set(ctx.chat.id, 'en');
  ctx.reply(STRINGS.en.lang_changed, makeKeyboard('en'));
});

bot.action('set_lang_hi', async (ctx) => {
  await ctx.answerCbQuery();
  userLanguages.set(ctx.chat.id, 'hi');
  ctx.reply(STRINGS.hi.lang_changed, makeKeyboard('hi'));
});

bot.command('find', matchUser);
bot.hears([STRINGS.en.find_btn, STRINGS.hi.find_btn], matchUser);

const handleSkip = async (ctx) => {
  const chatId = ctx.chat.id;
  await endChat(chatId, true);
  await ctx.reply('⏭️ ...');
  await matchUser(ctx);
};
bot.command('next', handleSkip);
bot.hears([STRINGS.en.skip_btn, STRINGS.hi.skip_btn], handleSkip);

const handleStop = async (ctx) => {
  const chatId = ctx.chat.id;
  const lang = getLang(chatId);
  const t = STRINGS[lang];

  if (!activePairs.has(chatId) && !queues.en.includes(chatId) && !queues.hi.includes(chatId)) {
    return ctx.reply(t.not_in, makeKeyboard(lang));
  }

  await endChat(chatId, true);
  ctx.reply(t.stopped, makeKeyboard(lang));
};
bot.command('stop', handleStop);
bot.hears([STRINGS.en.stop_btn, STRINGS.hi.stop_btn], handleStop);

bot.hears([STRINGS.en.lang_btn, STRINGS.hi.lang_btn], async (ctx) => {
  const chatId = ctx.chat.id;
  const nextLang = getLang(chatId) === 'en' ? 'hi' : 'en';
  if (activePairs.has(chatId)) await endChat(chatId, true);
  userLanguages.set(chatId, nextLang);
  ctx.reply(STRINGS[nextLang].lang_changed, makeKeyboard(nextLang));
});

bot.on('message', async (ctx) => {
  const chatId = ctx.chat.id;
  const partnerId = activePairs.get(chatId);
  const lang = getLang(chatId);

  if (ctx.message.text && ctx.message.text.startsWith('/')) return;
  if (!partnerId) return ctx.reply(STRINGS[lang].not_in, makeKeyboard(lang));

  try {
    await ctx.telegram.copyMessage(partnerId, chatId, ctx.message.message_id);
  } catch (err) {
    await endChat(chatId, false);
    ctx.reply(STRINGS[lang].partner_dropped, makeKeyboard(lang));
  }
});

bot.launch().then(() => console.log('Bot polling active!'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
        
