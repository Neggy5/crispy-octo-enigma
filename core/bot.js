// bot.js - ZUKO XMD — PULSE EDITION
// =============================================
// Trimmed build: only /pair, /delpair, /listpair confirm, /runtime, /ping.
// Redesigned UI: new "Pulse Grid" visual system.
// Buttons use the real Bot API 9.4 `style` field (added Feb 9, 2026):
// style: 'primary' = blue, style: 'danger' = red, style: 'success' = green.
// Requires a Telegram client version that supports Bot API 9.4+;
// older clients just fall back to the default button color.
// =============================================

require('dotenv').config();
require('../config/setting/config');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');
const { BOT_TOKEN } = require('../session/token');
const { autoLoadPairs } = require('./autoload');

// IMPORTANT: pair.js exports startpairing directly (module.exports = startpairing)
// So we require it directly as a function, not as an object with a .startpairing property
const startpairing = require('./pair');

// ========================
// INITIALIZATION
// ========================
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ========================
// FILE PATHS
// ========================
const DATA_DIR = path.join(__dirname, '..', 'storage', 'session-data');
const adminFilePath = path.join(DATA_DIR, 'admin.json');
const userFilePath = path.join(DATA_DIR, 'users.json');

// ========================
// DATA STORAGE
// ========================
let adminIDs = [];
let userIDs = new Set();

// Command cooldowns
const cooldowns = new Map();

// ========================
// PULSE — VISUAL DESIGN SYSTEM
// ========================
// Blue = primary / informational / go
// Red  = danger / blocking / stop
const PULSE = {
    barBlue: '🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦',
    barRed:  '🟥🟥🟥🟥🟥🟥🟥🟥🟥🟥',
    divider: '┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄',
    dot:     '◆',
    arrow:   '➤',
    footer:  '◆ ZUKO · PULSE ◆',
};

// Frames a title inside a header card, e.g.
// 🔷 PULSE // TITLE
const wrapTitle = (title, tone = 'blue') => {
    const chip = tone === 'red' ? '🔻' : '🔷';
    return `${chip} *PULSE* // *${title.toUpperCase()}*`;
};

// ========================
// SOCIAL LINKS (requirements)
// ========================
const SOCIAL_LINKS = {
    group: 'https://t.me/zukoxmd',
    channel: 'https://t.me/zukoxmd1'
};

// ========================
// IMAGE URLS
// ========================
const BANNER_URL = 'https://litter.catbox.moe/fjap9flgxguzovrm.jpg';

// ========================
// AUTHORIZATION SETTINGS
// ========================
const REQUIRE_MEMBERSHIP = true;
const REQUIRED_GROUPS = ['@zukoxmd'];
const REQUIRED_CHANNELS = [
    { link: '@zukoxmd1', name: 'ZUKO XMD CHANNEL' }
];

// ========================
// HELPER FUNCTIONS
// ========================
const exists = async (filePath) => {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const ensureDirectoryExists = async (dirPath) => {
    try {
        await fs.mkdir(dirPath, { recursive: true });
    } catch (err) {
        if (err.code !== 'EEXIST') throw err;
    }
};

function runtime(seconds) {
    seconds = Number(seconds);
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (s > 0 || parts.length === 0) parts.push(`${s}s`);
    return parts.join(' ');
}

const formatNumber = (num) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
};

// ========================
// DATA LOAD/SAVE FUNCTIONS
// ========================
const loadAdminIDs = async () => {
    const ownerID = '8361355527';
    const defaultAdmins = [ownerID];

    await ensureDirectoryExists(DATA_DIR);

    if (!(await exists(adminFilePath))) {
        await fs.writeFile(adminFilePath, JSON.stringify(defaultAdmins, null, 2));
        adminIDs = defaultAdmins;
        console.log(chalk.green('✓ Created admin.json'));
    } else {
        try {
            const raw = await fs.readFile(adminFilePath, 'utf8');
            adminIDs = JSON.parse(raw);
            if (!Array.isArray(adminIDs)) adminIDs = defaultAdmins;
        } catch (err) {
            console.error(chalk.red('✗ Error loading admin.json:'), err);
            adminIDs = defaultAdmins;
        }
    }
    console.log(chalk.cyan(`📥 Loaded ${adminIDs.length} admin(s)`));
};

const loadUserIDs = async () => {
    if (await exists(userFilePath)) {
        try {
            const raw = await fs.readFile(userFilePath, 'utf8');
            const users = JSON.parse(raw);
            userIDs = new Set(Array.isArray(users) ? users : []);
            console.log(chalk.cyan(`📥 Loaded ${userIDs.size} user(s)`));
        } catch (err) {
            console.error(chalk.red('✗ Error loading users.json:'), err);
            userIDs = new Set();
        }
    }
};

const saveUserIDs = async () => {
    try {
        await fs.writeFile(userFilePath, JSON.stringify([...userIDs], null, 2));
    } catch (err) {
        console.error(chalk.red('✗ Error saving users.json:'), err);
    }
};

// ========================
// USER TRACKING
// ========================
const trackUser = async (userId) => {
    const userIdStr = userId.toString();
    if (!userIDs.has(userIdStr)) {
        userIDs.add(userIdStr);
        await saveUserIDs();
        console.log(chalk.green(`✓ New user: ${userIdStr}`));
    }
};

// ========================
// MEMBERSHIP CHECK
// ========================
const checkMembership = async (userId) => {
    if (!REQUIRE_MEMBERSHIP) {
        return {
            hasJoinedGroup: true,
            hasJoinedAllChannels: true,
            hasJoinedAll: true,
            missingChannels: []
        };
    }

    try {
        const groupChecks = await Promise.all(
            REQUIRED_GROUPS.map(g => bot.getChatMember(g, userId).catch(() => null))
        );

        const channelChecks = await Promise.all(
            REQUIRED_CHANNELS.map(channel =>
                bot.getChatMember(channel.link, userId).catch(() => null)
            )
        );

        const validStatuses = ['member', 'administrator', 'creator'];
        const hasJoinedGroup = groupChecks.every(m => m && validStatuses.includes(m.status));
        const hasJoinedAllChannels = channelChecks.every(member => member && validStatuses.includes(member.status));

        return {
            hasJoinedGroup,
            hasJoinedAllChannels,
            hasJoinedAll: hasJoinedGroup && hasJoinedAllChannels,
            missingChannels: REQUIRED_CHANNELS.filter((_, idx) => !channelChecks[idx])
        };
    } catch (error) {
        console.error(chalk.red('Membership check error:'), error.message);
        return {
            hasJoinedGroup: false,
            hasJoinedAllChannels: false,
            hasJoinedAll: false,
            missingChannels: REQUIRED_CHANNELS
        };
    }
};

// ========================
// UI HELPERS
// ========================
// tone: 'blue' (default, informational/success) or 'red' (warning/danger)
const sendStyledMessage = async (chatId, title, content, buttons = null, tone = 'blue') => {
    const bar = tone === 'red' ? PULSE.barRed : PULSE.barBlue;
    const styledText =
`${wrapTitle(title, tone)}
${bar}
${content}
${PULSE.divider}
_${PULSE.footer}_`;

    const options = {
        caption: styledText,
        parse_mode: 'Markdown'
    };

    if (buttons) {
        options.reply_markup = { inline_keyboard: buttons };
    }

    return bot.sendPhoto(chatId, BANNER_URL, options);
};

const sendJoinRequirement = async (chatId) => {
    const content = `🔻 *ACCESS LOCKED*

  ${PULSE.dot} Join the group + channel below
  ${PULSE.dot} Then tap 🔵 *VERIFY*

  🔵 *GROUP*    ZUKO XMD
  🔵 *CHANNEL*  ZUKO XMD CHANNEL`;

    const keyboard = [
        [
            { text: 'JOIN GROUP', url: SOCIAL_LINKS.group, style: 'primary' },
            { text: 'JOIN CHANNEL', url: SOCIAL_LINKS.channel, style: 'primary' }
        ],
        [{ text: 'VERIFY NOW', callback_data: 'check_membership', style: 'primary' }],
        [{ text: 'CANCEL', callback_data: 'dismiss', style: 'danger' }]
    ];

    return sendStyledMessage(chatId, 'ACCESS REQUIRED', content, keyboard, 'red');
};

// ========================
// MIDDLEWARE
// ========================
const withCooldown = (command, seconds = 3) => {
    return (handler) => {
        return async (msg, match) => {
            const userId = msg.from.id;
            const key = `${userId}_${command}`;
            const now = Date.now();
            const cooldown = cooldowns.get(key);

            if (cooldown && now - cooldown < seconds * 1000) {
                const remaining = Math.ceil((seconds * 1000 - (now - cooldown)) / 1000);
                const content = `🔻 *Slow down!* Wait ${remaining}s before using this again.`;
                return sendStyledMessage(msg.chat.id, 'COOLDOWN', content, null, 'red');
            }

            cooldowns.set(key, now);
            return handler(msg, match);
        };
    };
};

const requireMembership = (handler) => {
    return async (msg, match) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        await trackUser(userId);

        if (!REQUIRE_MEMBERSHIP) {
            return handler(msg, match);
        }

        if (adminIDs.includes(userId.toString())) {
            return handler(msg, match);
        }

        const membership = await checkMembership(userId);

        if (!membership.hasJoinedAll) {
            return sendJoinRequirement(chatId);
        }

        return handler(msg, match);
    };
};

// ========================
// COMMAND HANDLERS
// ========================

// Start command — first contact: join-gate for regular users, welcome for verified/admins
bot.onText(/^\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    await trackUser(userId);

    const isAdmin = adminIDs.includes(userId.toString());

    if (!isAdmin && REQUIRE_MEMBERSHIP) {
        const membership = await checkMembership(userId);
        if (!membership.hasJoinedAll) {
            return sendJoinRequirement(chatId);
        }
    }

    const content = `🔵 *Welcome, ${msg.from.first_name || 'there'}!*

  📲 *COMMANDS*
  ${PULSE.arrow} /pair \`num\` — Connect WhatsApp
  ${PULSE.arrow} /delpair \`num\` — Remove device
  ${PULSE.arrow} /listpair confirm — View devices
  ${PULSE.arrow} /ping — Latency check
  ${PULSE.arrow} /runtime — Bot uptime`;

    await sendStyledMessage(chatId, 'WELCOME', content, [
        [
            { text: 'GROUP', url: SOCIAL_LINKS.group, style: 'primary' },
            { text: 'CHANNEL', url: SOCIAL_LINKS.channel, style: 'primary' }
        ]
    ]);
});

// Ping command
bot.onText(/\/ping/, requireMembership(withCooldown('ping', 5)(async (msg) => {
    const chatId = msg.chat.id;
    const start = Date.now();

    const sentMsg = await bot.sendPhoto(chatId, BANNER_URL, {
        caption: `🔵 *Pinging...*`,
        parse_mode: 'Markdown'
    });

    const latency = Date.now() - start;
    const apiLatency = sentMsg.date - msg.date;

    const isGood = latency < 200;
    const tone = isGood ? 'blue' : 'red';
    const bar = isGood ? PULSE.barBlue : PULSE.barRed;
    const pingStatus = latency < 100 ? 'Excellent' : latency < 200 ? 'Good' : latency < 500 ? 'Slow' : 'Very Slow';
    const pingChip = isGood ? '🔵' : '🔴';

    const pingEdit = `${wrapTitle('PONG!', tone)}
${bar}
  ${pingChip} *Response*   ${latency}ms
  🔵 *API Delay*   ${apiLatency}ms
  ${pingChip} *Quality*    ${pingStatus}
${PULSE.divider}
_${PULSE.footer}_`;

    await bot.editMessageMedia({
        type: 'photo',
        media: BANNER_URL,
        caption: pingEdit,
        parse_mode: 'Markdown'
    }, {
        chat_id: chatId,
        message_id: sentMsg.message_id
    });
})));

// Runtime command
bot.onText(/\/runtime/, requireMembership(async (msg) => {
    const chatId = msg.chat.id;
    const uptime = runtime(process.uptime());
    const memory = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

    const content = `🔵 *Status* — Online & Running

  ${PULSE.arrow} *Uptime*   ${uptime}
  ${PULSE.arrow} *Memory*   ${memory} MB
  ${PULSE.arrow} *Users*    ${formatNumber(userIDs.size)} registered`;

    await sendStyledMessage(chatId, 'SYSTEM STATUS', content, [
        [{ text: 'REFRESH', callback_data: 'refresh_runtime', style: 'primary' }]
    ]);
}));

// PAIR COMMAND
bot.onText(/\/pair (.+)/, requireMembership(withCooldown('pair', 10)(async (msg, match) => {
    const chatId = msg.chat.id;
    const number = match[1].trim();

    try {
        if (!number || /[a-z]/i.test(number) || !/^\d{7,15}$/.test(number) || number.startsWith('0')) {
            return sendStyledMessage(chatId, 'INVALID NUMBER', '🔻 *Use:* /pair 234XXXXXXXXX', null, 'red');
        }

        await sendStyledMessage(chatId, 'PAIRING', '🔵 *Processing your request...*');

        const jid = number.replace(/[^0-9]/g, '') + "@s.whatsapp.net";

        // DIRECT CALL - startpairing is the function itself
        await startpairing(jid);
        await sleep(4000);

        const pairingFile = path.join(DATA_DIR, 'pairing', 'pairing.json');

        if (!(await exists(pairingFile))) {
            return sendStyledMessage(chatId, 'PAIRING FAILED', '🔴 *Failed to generate code*\n  Please try again.', null, 'red');
        }

        const cu = await fs.readFile(pairingFile, 'utf-8');
        const cuObj = JSON.parse(cu);

        const senderNumber = number.replace(/[^0-9]/g, '');

        await sendStyledMessage(chatId, 'PAIRING SUCCESSFUL',
            `🔵 *Device Linked!*\n\n  ${PULSE.arrow} Number  ${senderNumber}\n  ${PULSE.arrow} Code    \`${cuObj.code}\`\n\n  Open WhatsApp › Linked Devices › Link a Device`);

    } catch (error) {
        console.error(chalk.red('Pair error:'), error);
        sendStyledMessage(chatId, 'PAIRING FAILED', `🔴 *ERROR*\n\n  ${error.message || 'Please try again'}`, null, 'red');
    }
})));

// Delpair command
bot.onText(/\/delpair (.+)/, requireMembership(async (msg, match) => {
    const chatId = msg.chat.id;
    const number = match[1].trim();

    try {
        if (!number || /[a-z]/i.test(number) || !/^\d{7,15}$/.test(number)) {
            return sendStyledMessage(chatId, 'INVALID NUMBER', '🔻 *Use:* /delpair 234XXXXXXXXX', null, 'red');
        }

        const jidSuffix = `${number}@s.whatsapp.net`;
        const pairingPath = path.join(DATA_DIR, 'pairing');

        if (!(await exists(pairingPath))) {
            return sendStyledMessage(chatId, 'DELETE FAILED', '🔴 *No session found*', null, 'red');
        }

        const entries = await fs.readdir(pairingPath, { withFileTypes: true });
        const matched = entries.find(entry => entry.isDirectory() && entry.name === jidSuffix);

        if (!matched) {
            return sendStyledMessage(chatId, 'NOT FOUND', `🔴 *${number} is not paired*`, null, 'red');
        }

        const targetPath = path.join(pairingPath, matched.name);
        await fs.rm(targetPath, { recursive: true, force: true });

        await sendStyledMessage(chatId, 'DEVICE REMOVED', `🔵 *Unlinked Successfully*\n\n  ${PULSE.arrow} ${number} has been removed.`);

        console.log(chalk.green(`🗑️ Deleted: ${number}`));
    } catch (err) {
        console.error(chalk.red('Delpair error:'), err);
        sendStyledMessage(chatId, 'DELETE FAILED', `🔴 *ERROR*\n\n  ${err.message}`, null, 'red');
    }
}));

// Listpair command (admin only)
bot.onText(/\/listpair confirm/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();

    if (!adminIDs.includes(userId)) {
        return sendStyledMessage(chatId, 'ADMIN ONLY', '🔴 *Access Denied*', null, 'red');
    }

    try {
        const pairingPath = path.join(DATA_DIR, 'pairing');

        if (!(await exists(pairingPath))) {
            return sendStyledMessage(chatId, 'PAIRED DEVICES', '🔴 *No devices found*', null, 'red');
        }

        const entries = await fs.readdir(pairingPath, { withFileTypes: true });
        const pairedDevices = entries
            .filter(entry => entry.isDirectory() && entry.name !== 'pairing.json' && entry.name.endsWith('@s.whatsapp.net'))
            .map(entry => entry.name);

        if (pairedDevices.length === 0) {
            return sendStyledMessage(chatId, 'PAIRED DEVICES', '🔴 *No devices found*', null, 'red');
        }

        let deviceList = `🔵 *${pairedDevices.length} device(s) linked*\n\n`;
        pairedDevices.forEach((device, index) => {
            const phoneNumber = device.split('@')[0];
            deviceList += `  ${PULSE.arrow} ${index + 1}. \`${phoneNumber}\`\n`;
        });

        await sendStyledMessage(chatId, 'PAIRED DEVICES', deviceList);
    } catch (err) {
        console.error(chalk.red('Listpair error:'), err);
        sendStyledMessage(chatId, 'ERROR', '🔴 *Failed to load devices*', null, 'red');
    }
});

// ========================
// CALLBACK QUERY HANDLER
// ========================
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    const userId = callbackQuery.from.id;
    const chatId = msg.chat.id;

    await trackUser(userId);

    if (data === 'dismiss') {
        await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Dismissed' });
        return bot.deleteMessage(chatId, msg.message_id).catch(() => {});
    }

    if (data === 'refresh_runtime') {
        await bot.answerCallbackQuery(callbackQuery.id, { text: '🔵 Refreshed' });
        const uptime = runtime(process.uptime());
        const memory = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
        const content = `🔵 *Status* — Online & Running

  ${PULSE.arrow} *Uptime*   ${uptime}
  ${PULSE.arrow} *Memory*   ${memory} MB
  ${PULSE.arrow} *Users*    ${formatNumber(userIDs.size)} registered`;

        const caption = `${wrapTitle('SYSTEM STATUS', 'blue')}\n${PULSE.barBlue}\n${content}\n${PULSE.divider}\n_${PULSE.footer}_`;
        await bot.editMessageMedia({
            type: 'photo',
            media: BANNER_URL,
            caption,
            parse_mode: 'Markdown'
        }, {
            chat_id: chatId,
            message_id: msg.message_id,
            reply_markup: { inline_keyboard: [[{ text: 'REFRESH', callback_data: 'refresh_runtime', style: 'primary' }]] }
        }).catch(() => {});
        return;
    }

    if (data === 'check_membership') {
        try {
            await bot.answerCallbackQuery(callbackQuery.id, { text: '🔵 Checking membership...' });

            const membership = await checkMembership(userId);

            if (membership.hasJoinedAll) {
                const content = `🔵 *Access Granted, ${callbackQuery.from.first_name}!*

  📲 *COMMANDS*
  ${PULSE.arrow} /pair \`num\` — Connect WhatsApp
  ${PULSE.arrow} /delpair \`num\` — Remove device
  ${PULSE.arrow} /listpair confirm — View devices
  ${PULSE.arrow} /ping — Latency check
  ${PULSE.arrow} /runtime — Bot uptime`;

                const verifiedCaption = `${wrapTitle('WELCOME', 'blue')}\n${PULSE.barBlue}\n${content}\n${PULSE.divider}\n_${PULSE.footer}_`;
                await bot.editMessageMedia({
                    type: 'photo',
                    media: BANNER_URL,
                    caption: verifiedCaption,
                    parse_mode: 'Markdown'
                }, {
                    chat_id: chatId,
                    message_id: msg.message_id,
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: 'GROUP', url: SOCIAL_LINKS.group, style: 'primary' },
                                { text: 'CHANNEL', url: SOCIAL_LINKS.channel, style: 'primary' }
                            ]
                        ]
                    }
                });
            } else {
                const deniedCaption = `${wrapTitle('ACCESS DENIED', 'red')}\n${PULSE.barRed}\n  You haven't joined the group & channel yet.\n  Join them and tap 🔵 *VERIFY* again.\n${PULSE.divider}\n_${PULSE.footer}_`;
                await bot.editMessageMedia({
                    type: 'photo',
                    media: BANNER_URL,
                    caption: deniedCaption,
                    parse_mode: 'Markdown'
                }, {
                    chat_id: chatId,
                    message_id: msg.message_id,
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: 'JOIN GROUP', url: SOCIAL_LINKS.group, style: 'primary' },
                                { text: 'JOIN CHANNEL', url: SOCIAL_LINKS.channel, style: 'primary' }
                            ],
                            [{ text: 'VERIFY AGAIN', callback_data: 'check_membership', style: 'primary' }],
                            [{ text: 'CANCEL', callback_data: 'dismiss', style: 'danger' }]
                        ]
                    }
                });
            }
        } catch (error) {
            console.error(chalk.red('Callback error:'), error);
            await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Error checking membership' });
        }
    }
});

// ========================
// UNKNOWN COMMAND HANDLER
// ========================
bot.on('message', async (msg) => {
    if (msg.text && msg.text.startsWith('/')) {
        const command = msg.text.split(' ')[0];
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        const validCommands = ['/start', '/pair', '/delpair', '/listpair', '/ping', '/runtime'];

        if (!validCommands.includes(command)) {
            await trackUser(userId);

            if (!adminIDs.includes(userId.toString()) && REQUIRE_MEMBERSHIP) {
                const membership = await checkMembership(userId);
                if (!membership.hasJoinedAll) {
                    return sendJoinRequirement(chatId);
                }
            }

            const content = `🔴 *Unknown command*

  📲 *AVAILABLE*
  ${PULSE.arrow} /pair \`num\`
  ${PULSE.arrow} /delpair \`num\`
  ${PULSE.arrow} /listpair confirm
  ${PULSE.arrow} /ping
  ${PULSE.arrow} /runtime`;

            sendStyledMessage(chatId, 'UNKNOWN COMMAND', content, null, 'red');
        }
    }
});

// ========================
// ERROR HANDLERS
// ========================
bot.on('polling_error', (error) => {
    console.error(chalk.red('Polling error:'), error.message);
});

bot.on('webhook_error', (error) => {
    console.error(chalk.red('Webhook error:'), error.message);
});

// ========================
// INITIALIZATION
// ========================
(async () => {
    console.log(chalk.cyan('\n◆ ⟦ ZUKO XMD PULSE — INITIALIZING ⟧'));
    console.log(chalk.cyan('┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n'));

    await ensureDirectoryExists(DATA_DIR);
    await ensureDirectoryExists(path.join(DATA_DIR, 'pairing'));

    await loadAdminIDs();
    await loadUserIDs();

    console.log(chalk.cyan(`
◆ ⟦ ZUKO XMD — PULSE EDITION ⟧
┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
  🔵 Status   Running
  🔵 Users    ${userIDs.size}
  🔵 Admins   ${adminIDs.length}
┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
◆ ZUKO · PULSE ◆
    `));

    console.log(chalk.green(`✓ Membership checking: ${REQUIRE_MEMBERSHIP ? 'ENABLED' : 'DISABLED'}`));
    console.log(chalk.green(`✓ All systems ready!\n`));

    // Auto-load pairs
    setTimeout(async () => {
        try {
            console.log(chalk.cyan('📱 Starting auto-load of paired devices...'));
            const result = await autoLoadPairs({ batchSize: 1 });
            if (result.success) {
                console.log(chalk.green(`✓ Auto-load completed: ${result.successful}/${result.total} users connected`));
                if (result.failedUsers && result.failedUsers.length > 0) {
                    console.log(chalk.yellow(`⚠️ Failed connections: ${result.failedUsers.length}`));
                }
            } else {
                console.log(chalk.yellow(`⚠️ Auto-load skipped: ${result.message}`));
            }
        } catch (err) {
            console.error(chalk.red('✗ Auto-load pairs failed:'), err.message);
        }
    }, 8000);
})();

// ========================
// SHUTDOWN HANDLERS
// ========================
const shutdown = async () => {
    console.log(chalk.yellow('\n🛑 Shutting down ZUKO XMD...'));
    await saveUserIDs();
    bot.stopPolling();
    console.log(chalk.green('✓ Data saved. Goodbye!'));
    process.exit(0);
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
process.on('uncaughtException', (error) => {
    console.error(chalk.red('Uncaught Exception:'), error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error(chalk.red('Unhandled Rejection:'), reason);
});
