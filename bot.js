const { Telegraf, Markup } = require('telegraf');
const express = require('express');

// Express server for Render health checks & keep-awake pings
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bilingual Anon Bot is running!'));
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

// Bot token from Render Environment Variables
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
    share_btn: '🔗 Invite Friends',
    searching: '🔍 Searching for an English partner. Please wait...',
    priority_search: '⚡ Priority match active! Placed at the front of the queue...',
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
    share_btn: '🔗 दोस्तों को जोड़ें',
    searching: '🔍 हिंदी में बात करने के लिए पार्टनर ढूंढा जा रहा है। प्रतीक्षा करें...',
    priority_search: '⚡ प्रायोरिटी मैच सक्रिय! आपको कतार में सबसे आगे रखा गया है...',
    connected: '🎉 आप एक अजनबी से जुड़ चुके हैं! नमस्ते बोलें।\n(बदलने के लिए "⏭️️ अगला / Skip" दबाएं)',
    disconnected: '❌ सामने वाले ने चैट छोड़ दी। फिर खोजने के लिए "🔎 पार्टनर ढूंढें" दबाएं।',
    stopped: 'चैट समाप्त हो गई। नई बातचीत के लिए "🔎 पार्टनर ढूंढें" दबाएं।',
    already_in: 'आप पहले से चैट में हैं! नया पार्टनर ढूंढने के लिए "⏭️ अगला / Skip" दबाएं।',
    not_in: 'आप अभी किसी चैट में नहीं हैं।',
    partner_dropped: 'पार्टनर का संपर्क टूट गया। नया पार्टनर खोजा जा रहा है...'
  }
};

// In-memory state tracking
const userLanguages = new Map();    // chatId -> 'en' | 'hi'
const activePairs = new Map();      // chatId -> partnerId
const queues = { en: [], hi: [] };  // Matchmaking wait queues
const userReferrals = new Map();    // referrerId -> Set(invitedUserIds)
const priorityCredits = new Map();  // chatId -> creditCount

function getLang(chatId) {
  return userLanguages.get(chatId) || 'en';
}

function makeKeyboard(lang) {
  const t = STRINGS[lang];
  return Markup.keyboard([
    [t.find_btn, t.skip_btn],
    [t.stop_btn, t.share_btn],
    [t.lang_btn]
  ]).resize();
}

const languagePicker = Markup.inlineKeyboard([
  [Markup.button.callback('🇬🇧 English', 'set_lang_en'), Markup.button.callback('🇮🇳 हिंदी', 'set_lang_hi')]
]);

function recordReferral(referrerId, newUserId) {
  if (String(referrerId) === String(newUserId)) return;

  if (!userReferrals.has(referrerId)) {
    userReferrals.set(referrerId, new Set());
  }

  const invitedSet = userReferrals.get(referrerId);
  if (!invitedSet.has(newUserId)) {
    invitedSet.add(newUserId);
    const credits = (priorityCredits.get(Number(referrerId)) || 0) + 3;
    priorityCredits.set(Number(referrerId), credits);

    const refLang = getLang(Number(referrerId));
    const alertMsg = refLang === 'hi'
      ? `🎉 किसी ने आपके इनवाइट लिंक से बॉट जॉइन किया!\n⚡ आपको 3 प्रायोरिटी मैच क्रेडिट मिले हैं। (कुल इनवाइट्स: ${invitedSet.size})`
      : `🎉 Someone joined using your invite link!\n⚡ You earned 3 Priority Match credits! (Total invites: ${invitedSet.size})`;

    bot.telegram.sendMessage(referrerId, alertMsg).catch(() => {});
  }
}

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
  // Ensure matchmaking runs only in private DMs
  if (ctx.chat.type !== 'private') {
    const botUser = ctx.botInfo.username;
    return ctx.reply(
      '⚠️ Anonymous 1-on-1 chats happen in private DM!\nTap below to start matching:',
      Markup.inlineKeyboard([[Markup.button.url('🤫 Open Bot in DM', `https://t.me/${botUser}?start=group`)]])
    );
  }

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
    const credits = priorityCredits.get(chatId) || 0;
    if (credits > 0) {
      priorityCredits.set(chatId, credits - 1);
      queue.unshift(chatId);
      ctx.reply(`${t.priority_search}\n(⚡ Remaining priority credits: ${credits - 1})`, makeKeyboard(lang));
    } else {
      queue.push(chatId);
      ctx.reply(t.searching, makeKeyboard(lang));
    }
  }
}

// Generate referral menu
async function sendShareMenu(ctx) {
  const chatId = ctx.chat.id;
  const lang = getLang(chatId);
  const botUser = ctx.botInfo.username;
  const refLink = `https://t.me/${botUser}?start=ref_${chatId}`;
  
  const credits = priorityCredits.get(chatId) || 0;
  const count = (userReferrals.get(String(chatId)) || new Set()).size;

  const shareText = "Chat anonymously with random strangers on Telegram!";
  const tgShareUrl = `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent(shareText)}`;

  const msgEn = `🔗 *Your Personal Invite Link:*\n\`${refLink}\`\n\n🎁 *Reward:* Earn 3 Priority Matches for every friend who joins!\n⚡ *Active Priority Credits:* ${credits}\n👥 *Total Friends Invited:* ${count}`;
  const msgHi = `🔗 *आपका पर्सनल इनवाइट लिंक:*\n\`${refLink}\`\n\n🎁 *इनाम:* हर दोस्त के जुड़ने पर 3 प्रायोरिटी मैच पाएं!\n⚡ *सक्रिय प्रायोरिटी क्रेडिट्स:* ${credits}\n👥 *कुल आमंत्रित दोस्त:* ${count}`;

  const shareKeyboard = Markup.inlineKeyboard([
    [Markup.button.url('📲 Forward to Friends', tgShareUrl)]
  ]);

  await ctx.replyWithMarkdown(lang === 'hi' ? msgHi : msgEn, shareKeyboard);
}

// ---------------- GROUP AUTO-WELCOME HANDLER ----------------
bot.on('new_chat_members', async (ctx) => {
  const members = ctx.message.new_chat_members;
  const botUser = ctx.botInfo.username;

  for (const member of members) {
    if (member.id === ctx.botInfo.id) {
      // The bot itself was added to the group
      await ctx.reply(
        `👋 Namaste everyone! I am *Chit Chatter*.\n\nUse me to find random anonymous chat partners across India!`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.url('🤫 Start Anonymous Chat', `https://t.me/${botUser}?start=group_intro`)]
          ])
        }
      );
      continue;
    }

    // A regular user joined the group
    const name = member.first_name || 'Dost';
    const welcomeText = `👋 नमस्ते [${name}](tg://user?id=${member.id})! Welcome to the group!\n\nWant to talk 1-on-1 with a stranger across India with 100% anonymity?`;

    await ctx.reply(welcomeText, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.url('🤫 Start Anonymous Chat / चैट शुरू करें', `https://t.me/${botUser}?start=group_join`)]
      ])
    });
  }
});

// Start command
bot.start((ctx) => {
  if (ctx.chat.type !== 'private') {
    const botUser = ctx.botInfo.username;
    return ctx.reply(
      'Tap below to open private chat:',
      Markup.inlineKeyboard([[Markup.button.url('Start Bot in DM', `https://t.me/${botUser}?start=menu`)]])
    );
  }

  const payload = ctx.startPayload;
  if (payload && payload.startsWith('ref_')) {
    const referrerId = payload.replace('ref_', '');
    recordReferral(referrerId, ctx.chat.id);
  }
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
  if (ctx.chat.type !== 'private') return;
  const chatId = ctx.chat.id;
  await endChat(chatId, true);
  await ctx.reply('⏭️ ...');
  await matchUser(ctx);
};
bot.command('next', handleSkip);
bot.hears([STRINGS.en.skip_btn, STRINGS.hi.skip_btn], handleSkip);

const handleStop = async (ctx) => {
  if (ctx.chat.type !== 'private') return;
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

bot.command(['share', 'invite'], sendShareMenu);
bot.hears([STRINGS.en.share_btn, STRINGS.hi.share_btn], sendShareMenu);

bot.hears([STRINGS.en.lang_btn, STRINGS.hi.lang_btn], async (ctx) => {
  if (ctx.chat.type !== 'private') return;
  const chatId = ctx.chat.id;
  const nextLang = getLang(chatId) === 'en' ? 'hi' : 'en';
  if (activePairs.has(chatId)) await endChat(chatId, true);
  userLanguages.set(chatId, nextLang);
  ctx.reply(STRINGS[nextLang].lang_changed, makeKeyboard(nextLang));
});

// Relay messages between matched strangers
bot.on('message', async (ctx) => {
  // CRITICAL: Ignore messages sent in group chats so regular banter isn't interrupted
  if (ctx.chat.type !== 'private') return;

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
