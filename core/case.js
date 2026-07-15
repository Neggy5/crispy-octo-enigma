// case.js — ZUKO XMD message handler (fresh skeleton)
// =============================================
// Bare-bones build: only /ping and /menu wired up.
// Add new commands as new `case '...':` blocks inside the switch below.
// =============================================

require('../config/setting/config');
const {
    default: baileys,
    getContentType,
    downloadContentFromMessage
} = require("@whiskeysockets/baileys");

const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
const { getSetting, setSetting } = require("../config/setting/Settings.js");

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

// ========== MENU IMAGE ==========
const MENU_IMAGE_PATH = './media/logo.jpg';
let menuImageBuffer = null;
try {
    if (fs.existsSync(MENU_IMAGE_PATH)) {
        menuImageBuffer = fs.readFileSync(MENU_IMAGE_PATH);
    }
} catch (e) {}
global.menuImage = menuImageBuffer || 'https://files.catbox.moe/xxrf9p.jpg';

// ========== HELPERS ==========
const delay = (ms) => new Promise(r => setTimeout(r, ms));

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

        if (!isCmd) return;

        switch (command) {
        case 'play': 
case 'play2': {
    if (!text) {
        return zreply(`🎵 *zuko xmd ▶️*\n\nUsage: ${prefix}play [song name]\nExample: ${prefix}play faded`);
    }
    
    try {
        // Use the correct socket variable (empire instead of bad)
        await empire.sendMessage(m.chat, {react: {text: '🎧', key: m.key}});
        
        reply(`⏳ *zuko xmd ▶️*\n\nSearching: ${text}\nGive me a moment...`);
        
        const response = await axios.get(`https://apis.davidcyril.name.ng/play?query=${encodeURIComponent(text)}&apikey=`, {
            timeout: 60000
        });
        
        console.log('David Cyril API Response:', JSON.stringify(response.data, null, 2));
        
        const data = response.data;
        
        if (data.status && data.result?.download_url) {
            reply(`🎵 *zuko xmd ▶️*\n\nTitle: ${data.result.title || 'N/A'}\nDuration: ${data.result.duration || 'N/A'}\nViews: ${data.result.views?.toLocaleString() || 'N/A'}\n\nDownloading audio...`);
            
            const audioResponse = await axios.get(data.result.download_url, {
                responseType: 'arraybuffer',
                timeout: 120000
            });
            
            const audioBuffer = Buffer.from(audioResponse.data);
            
            // Use empire here too
            await empire.sendMessage(m.chat, {
                audio: audioBuffer,
                mimetype: "audio/mpeg",
                fileName: `${data.result.title}.mp3`,
                contextInfo: { 
                    externalAdReply: {
                        thumbnailUrl: data.result.thumbnail, 
                        title: data.result.title, 
                        body: `👁️ ${data.result.views.toLocaleString()} views • ⏱️ ${data.result.duration}`, 
                        sourceUrl: data.result.video_url, 
                        renderLargerThumbnail: true, 
                        mediaType: 1
                    }
                }
            }, {quoted: m});
            
            // Use empire here too
            await empire.sendMessage(m.chat, {react: {text: '✅', key: m.key}});
            
        } else {
            throw new Error('No audio download link received from API');
        }
        
    } catch (error) {
        console.error('Play Error:', error.response?.data || error.message);
        
        // Use violet here too
        await empire.sendMessage(m.chat, {react: {text: '❌', key: m.key}});
        
        if (error.response?.status === 404) {
            return reply(`❌ *zuko xmd ▶️ *\n\nTrack "${text}" not found. Try a different song or check spelling.`);
        }
        
        return reply(`⚠️ *zuko xmd play*\n\nMusic service is napping. Try again in a moment.`);
    }
}
break;
 
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

// ========== HOT RELOAD ==========
let file = require.resolve(__filename);
require('fs').watchFile(file, () => {
    require('fs').unwatchFile(file);
    console.log('\x1b[0;32m' + __filename + ' updated!\x1b[0m');
    delete require.cache[file];
    require(file);
});
