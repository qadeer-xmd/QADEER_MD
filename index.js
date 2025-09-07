const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  jidNormalizedUser,
  getContentType,
  proto,
  generateForwardMessageContent,
  generateWAMessageFromContent,
  downloadContentFromMessage,
  jidDecode,
  fetchLatestBaileysVersion,
  Browsers
} = require('@whiskeysockets/baileys');

const fs = require('fs');
const fse = require('fs-extra');
const path = require('path');
const os = require('os');
const util = require('util');
const P = require('pino');
const axios = require('axios');
const FileType = require('file-type');
const express = require('express');
const { File } = require('megajs');

// ====== LOCAL MODULES (make sure these paths/files exist) ======
if (fs.existsSync('config.env')) require('dotenv').config({ path: './config.env' });
if (fs.existsSync('.env')) require('dotenv').config();

const config = require('./config'); // your provided config.js (keys already aligned)
const GroupEvents = require('./lib/groupevents'); // should exist if you use welcome/goodbye/admin events
const { sms, downloadMediaMessage: dlMedia, AntiDelete } = require('./lib'); // lib/index aggregator
const { getBuffer, getGroupAdmins, sleep } = require('./lib/functions'); // helper funcs you shared
const events = require('./command'); // your commands registry (cmd/AddCommand/commands array)

// ====== CONSTANTS ======
const prefix = config.PREFIX || '.';
const OWNER_NUMBER = (config.OWNER_NUMBER || '923131613251').replace(/[^0-9]/g, '');
const OWNER_JID = OWNER_NUMBER + '@s.whatsapp.net';
const BOT_NAME = config.BOT_NAME || 'QADEER_MD';
const OWNER_NAME = config.OWNER_NAME || 'QADEER BRAHVI';
const CHANNEL_URL = process.env.CHANNEL_URL || process.env.CHANNEL || ''; // optional
const MENU_IMAGE_URL = config.MENU_IMAGE_URL || 'https://files.catbox.moe/7nf8cb.jpg';

// ====== KEEPALIVE MINI SERVER ======
const app = express();
app.get('/', (_req, res) => res.send(`${BOT_NAME} is alive ✅`));
app.get('/health', (_req, res) => res.json({ ok: true, bot: BOT_NAME, time: Date.now() }));
const PORT = process.env.PORT || 9090;
app.listen(PORT, () => console.log(`[HTTP] ${BOT_NAME} server on :${PORT}`));

// ====== TEMP CACHE CLEANER ======
const tempDir = path.join(os.tmpdir(), `${BOT_NAME.toLowerCase()}-cache`);
fse.ensureDirSync(tempDir);
setInterval(() => {
  fs.readdir(tempDir, (err, files) => {
    if (err) return;
    for (const f of files) {
      fs.unlink(path.join(tempDir, f), () => {});
    }
  });
}, 5 * 60 * 1000);

// ====== SESSION LOADER (External Pairing Support) ======
async function ensureSession() {
  const credPathDir = path.join(__dirname, 'sessions');
  const credPath = path.join(credPathDir, 'creds.json');
  fse.ensureDirSync(credPathDir);

  if (fs.existsSync(credPath)) {
    console.log('[SESSION] Using existing sessions/creds.json ✅');
    return;
  }

  const SID = process.env.SESSION_ID || config.SESSION_ID || '';
  if (!SID) {
    console.log('[SESSION] SESSION_ID missing! Put it in config.env or environment.');
    return;
  }

  try {
    if (SID.startsWith('BASE64:')) {
      const b64 = SID.slice(7).trim();
      const buff = Buffer.from(b64, 'base64');
      fs.writeFileSync(credPath, buff);
      console.log('[SESSION] creds.json restored from BASE64 ✅');
      return;
    }

    if (SID.startsWith('MEGA:')) {
      const megaId = SID.slice(5).trim(); // full mega file id (with key if needed)
      const file = File.fromURL(`https://mega.nz/file/${megaId}`);
      file.download((err, data) => {
        if (err) throw err;
        fs.writeFileSync(credPath, data);
        console.log('[SESSION] creds.json downloaded from MEGA ✅');
      });
      // Small wait to ensure write completes in most envs
      await sleep(2000);
      return;
    }

    if (SID.startsWith('URL:')) {
      const url = SID.slice(4).trim();
      const resp = await axios.get(url, { responseType: 'arraybuffer' });
      fs.writeFileSync(credPath, resp.data);
      console.log('[SESSION] creds.json fetched from URL ✅');
      return;
    }

    // Backward compat (some old formats used a plain mega id without prefix)
    if (/^[A-Za-z0-9_\-#]+$/.test(SID)) {
      const file = File.fromURL(`https://mega.nz/file/${SID}`);
      file.download((err, data) => {
        if (err) throw err;
        fs.writeFileSync(credPath, data);
        console.log('[SESSION] creds.json downloaded from MEGA (legacy) ✅');
      });
      await sleep(2000);
      return;
    }

    console.log('[SESSION] Unknown SESSION_ID format. Supported: BASE64:, MEGA:, URL:.');
  } catch (e) {
    console.error('[SESSION] Failed to restore creds:', e.message);
  }
}

// ====== MAIN CONNECTOR ======
async function connectToWA() {
  await ensureSession();

  console.log(`[BOOT] Connecting ${BOT_NAME} to WhatsApp… ⏳`);
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'sessions'));
  const { version } = await fetchLatestBaileysVersion();

  const conn = makeWASocket({
    logger: P({ level: 'silent' }),
    printQRInTerminal: false, // pairing handled externally
    browser: Browsers.macOS('Firefox'),
    syncFullHistory: true,
    auth: state,
    version
  });

  // ====== CONNECTION EVENTS ======
  conn.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update || {};
    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log('[CONN] Closed. Reason:', reason);
      if (reason !== DisconnectReason.loggedOut) {
        connectToWA();
      } else {
        console.log('[CONN] Logged out. Delete sessions & re-pair.');
      }
    } else if (connection === 'open') {
      console.log('[CONN] Connected ✅');

      // Load plugins
      console.log('🧬 Installing Plugins…');
      const plugDir = path.join(__dirname, 'plugins');
      fse.ensureDirSync(plugDir);
      fs.readdirSync(plugDir).forEach((p) => {
        if (path.extname(p).toLowerCase() === '.js') {
          try {
            require(path.join(plugDir, p));
            console.log('  •', p);
          } catch (e) {
            console.error('  x', p, '->', e.message);
          }
        }
      });
      console.log('Plugins installed ✅');

      // Intro DM to self
      const lines = [
        `*Hello ${BOT_NAME} user!* 👋`,
        `> Straightforward, stable & feature-rich WhatsApp bot.`,
        '',
        `*Owner:* ${OWNER_NAME}`,
        `*Prefix:* ${prefix}`,
        CHANNEL_URL ? `*Channel:* ${CHANNEL_URL}` : '',
        '',
        `⭐ Star the repo if you like it.`,
      ].filter(Boolean).join('\n');

      conn.sendMessage(conn.user.id, { image: { url: MENU_IMAGE_URL }, caption: lines })
        .catch(() => {});

    }
  });

  conn.ev.on('creds.update', saveCreds);

  // ====== ANTI-DELETE (message updates) ======
  conn.ev.on('messages.update', async (updates) => {
    for (const u of updates) {
      if (u.update?.message === null) {
        console.log('[ANTI-DELETE] Message delete detected.');
        try { await AntiDelete(conn, updates); } catch {}
      }
    }
  });

  // ====== GROUP EVENTS ======
  conn.ev.on('group-participants.update', (update) => {
    try { GroupEvents(conn, update); } catch {}
  });

  // ====== MESSAGE UPSERT ======
  conn.ev.on('messages.upsert', async (m) => {
    try {
      let mek = m.messages?.[0];
      if (!mek || !mek.message) return;

      // unwrap ephemeral
      mek.message = (getContentType(mek.message) === 'ephemeralMessage')
        ? mek.message.ephemeralMessage.message
        : mek.message;

      // mark read if enabled
      if (config.READ_MESSAGE === 'true') {
        await conn.readMessages([mek.key]).catch(() => {});
      }

      // viewOnce unwrap
      if (mek.message.viewOnceMessageV2) {
        mek.message = (getContentType(mek.message) === 'ephemeralMessage')
          ? mek.message.ephemeralMessage.message
          : mek.message;
      }

      // status seen
      if (mek.key && mek.key.remoteJid === 'status@broadcast' && config.AUTO_STATUS_SEEN === 'true') {
        await conn.readMessages([mek.key]).catch(() => {});
      }

      // status react
      if (mek.key && mek.key.remoteJid === 'status@broadcast' && config.AUTO_STATUS_REACT === 'true') {
        const me = await conn.decodeJid(conn.user.id);
        const emojis = ['❤️','💸','😇','🍂','💥','💯','🔥','💫','💎','💗','🤍','🖤','👀','🙌','🚩','🥰','💐','😎','🤎','✅','🫀','🧡','😁','😄','🌸','🕊️','🌷','⛅','🌟','🗿','🇵🇰','💜','💙','🌝','💚'];
        const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
        await conn.sendMessage(mek.key.remoteJid, {
          react: { text: randomEmoji, key: mek.key }
        }, { statusJidList: [mek.key.participant, me] }).catch(() => {});
      }

      // status auto-reply
      if (mek.key && mek.key.remoteJid === 'status@broadcast' && config.AUTO_STATUS_REPLY === 'true') {
        const user = mek.key.participant;
        const text = `${config.AUTO_STATUS_MSG || '*SEEN YOUR STATUS BY QADEER_MD 🤍*'}`;
        await conn.sendMessage(user, { text, react: { text: '💜', key: mek.key } }, { quoted: mek }).catch(() => {});
      }

      // build sms wrapper
      const mwrap = sms(conn, mek);
      const type = getContentType(mek.message);
      const from = mek.key.remoteJid;
      const isGroup = from.endsWith('@g.us');

      const body =
        (type === 'conversation' && mek.message.conversation) ? mek.message.conversation :
        (type === 'extendedTextMessage' && mek.message.extendedTextMessage?.text) ? mek.message.extendedTextMessage.text :
        (type === 'imageMessage' && mek.message.imageMessage?.caption) ? mek.message.imageMessage.caption :
        (type === 'videoMessage' && mek.message.videoMessage?.caption) ? mek.message.videoMessage.caption :
        '';

      const isCmd = body?.startsWith(prefix);
      const args = (body || '').trim().split(/\s+/).slice(1);
      const q = args.join(' ');
      const text = q;
      const sender = mek.key.fromMe
        ? ((conn.user.id.split(':')[0] + '@s.whatsapp.net') || conn.user.id)
        : (mek.key.participant || mek.key.remoteJid);

      const senderNumber = (sender || '').split('@')[0];
      const botNumber = conn.user.id.split(':')[0];
      const pushname = mek.pushName || 'User';
      const botJid = await jidNormalizedUser(conn.user.id);

      const groupMetadata = isGroup ? await conn.groupMetadata(from).catch(() => null) : null;
      const groupName = isGroup ? (groupMetadata?.subject || '') : '';
      const participants = isGroup ? (groupMetadata?.participants || []) : [];
      const groupAdmins = isGroup ? await getGroupAdmins(participants) : [];
      const isBotAdmins = isGroup ? groupAdmins.includes(botJid) : false;
      const isAdmins = isGroup ? groupAdmins.includes(sender) : false;

      const reply = (t) => conn.sendMessage(from, { text: t }, { quoted: mek });

      // OWNER / CREATOR
      const isMe = botNumber.includes(senderNumber);
      const isOwner = [OWNER_NUMBER].includes(senderNumber) || isMe;
      const isCreator = [botNumber, OWNER_NUMBER, (config.DEV || OWNER_NUMBER)]
        .map(v => v.replace(/[^0-9]/g, '') + '@s.whatsapp.net')
        .includes(mek.sender);

      // owner auto react
      const isReact = !!mwrap.message.reactionMessage;
      if (senderNumber.includes(OWNER_NUMBER) && !isReact) {
        const reactions = ['👑','💀','📊','⚙️','🧠','🎯','📈','📝','🏆','🌍','🇵🇰','💗','❤️','💥','🌼','🏵️','💐','🔥','❄️','🌝','🌚','🐥','🧊'];
        const r = reactions[Math.floor(Math.random() * reactions.length)];
        mwrap.react(r).catch(() => {});
      }

      // public auto react
      if (!isReact && config.AUTO_REACT === 'true') {
        const reactions = ['🌼','❤️','💐','🔥','🏵️','❄️','🧊','🐳','💥','🥀','❤‍🔥','🥹','😩','🫣','🤭','👻','👾','🫶','😻','🙌','🫂','🫀','🏆','🎯','🚀','🗿','⌛','⏳','💸','💎','📊','📈','📌','🔖','✅','🚩','🇵🇰'];
        const r = reactions[Math.floor(Math.random() * reactions.length)];
        mwrap.react(r).catch(() => {});
      }

      // WORKTYPE modes
      if (!isOwner && config.MODE === 'private') return;
      if (!isOwner && isGroup && config.MODE === 'inbox') return;
      if (!isOwner && !isGroup && config.MODE === 'groups') return;

      // COMMAND DISPATCH
      const cmdName = isCmd ? body.slice(prefix.length).trim().split(/\s+/)[0].toLowerCase() : false;

      if (isCmd) {
        const found = events.commands.find(c => c.pattern === cmdName) ||
                      events.commands.find(c => c.alias && c.alias.includes(cmdName));
        if (found) {
          if (found.react) {
            conn.sendMessage(from, { react: { text: found.react, key: mek.key }}).catch(() => {});
          }
          try {
            await found.function(conn, mek, mwrap, {
              from, body, isCmd, cmdName, args, q, text,
              isGroup, sender, senderNumber, botNumber, botJid,
              pushname, isMe, isOwner, isCreator,
              groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply
            });
          } catch (e) {
            console.error('[PLUGIN ERROR]', e);
            reply('⚠️ Plugin error: ' + (e.message || e));
          }
        }
      }

      // “on” handlers
      for (const command of events.commands) {
        try {
          if (body && command.on === 'body') {
            await command.function(conn, mek, mwrap, { from, body, args, q, text, isGroup, sender, senderNumber, botJid, botNumber, pushname, isMe, isOwner, isCreator, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply });
          } else if (mek.q && command.on === 'text') {
            await command.function(conn, mek, mwrap, { from, body, args, q, text, isGroup, sender, senderNumber, botJid, botNumber, pushname, isMe, isOwner, isCreator, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply });
          } else if ((command.on === 'image' || command.on === 'photo') && m.type === 'imageMessage') {
            await command.function(conn, mek, mwrap, { from, body, args, q, text, isGroup, sender, senderNumber, botJid, botNumber, pushname, isMe, isOwner, isCreator, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply });
          } else if (command.on === 'sticker' && m.type === 'stickerMessage') {
            await command.function(conn, mek, mwrap, { from, body, args, q, text, isGroup, sender, senderNumber, botJid, botNumber, pushname, isMe, isOwner, isCreator, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply });
          }
        } catch {}
      }

    } catch (err) {
      console.error('[UPSERT ERROR]', err);
    }
  });

  // ====== HELPERS ======
  conn.decodeJid = (jid) => {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid)) {
      const d = jidDecode(jid) || {};
      return (d.user && d.server) ? `${d.user}@${d.server}` : jid;
    }
    return jid;
  };

  conn.copyNForward = async (jid, message, forceForward = false, options = {}) => {
    let vtype;
    if (options.readViewOnce) {
      message.message = message.message?.ephemeralMessage?.message ? message.message.ephemeralMessage.message : (message.message || undefined);
      vtype = Object.keys(message.message.viewOnceMessage.message)[0];
      delete message.message?.ignore;
      delete message.message.viewOnceMessage.message[vtype].viewOnce;
      message.message = { ...message.message.viewOnceMessage.message };
    }
    let mtype = Object.keys(message.message)[0];
    let content = await generateForwardMessageContent(message, forceForward);
    let ctype = Object.keys(content)[0];
    let context = {};
    if (mtype !== 'conversation') context = message.message[mtype].contextInfo;
    content[ctype].contextInfo = { ...context, ...content[ctype].contextInfo };
    const waMessage = await generateWAMessageFromContent(jid, content, options ? {
      ...content[ctype],
      ...options,
      ...(options.contextInfo ? { contextInfo: { ...content[ctype].contextInfo, ...options.contextInfo } } : {})
    } : {});
    await conn.relayMessage(jid, waMessage.message, { messageId: waMessage.key.id });
    return waMessage;
  };

  conn.downloadAndSaveMediaMessage = async (message, filename, attachExtension = true) => {
    const quoted = message.msg ? message.msg : message;
    const mime = (message.msg || message).mimetype || '';
    const messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
    const stream = await downloadContentFromMessage(quoted, messageType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    const type = await FileType.fromBuffer(buffer);
    const trueFileName = attachExtension ? `${filename}.${type.ext}` : filename;
    fs.writeFileSync(trueFileName, buffer);
    return trueFileName;
  };

  conn.downloadMediaMessage = async (message) => {
    const mime = (message.msg || message).mimetype || '';
    const messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
    const stream = await downloadContentFromMessage(message, messageType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    return buffer;
  };

  conn.sendFileUrl = async (jid, url, caption, quoted, options = {}) => {
    let mime = '';
    const res = await axios.head(url).catch(() => null);
    mime = res?.headers?.['content-type'] || '';
    if (!mime) {
      // fallback: try get
      const d = await axios.get(url, { responseType: 'arraybuffer' });
      const t = await FileType.fromBuffer(Buffer.from(d.data));
      mime = t ? t.mime : 'application/octet-stream';
    }

    if (mime.split('/')[1] === 'gif') {
      return conn.sendMessage(jid, { video: await getBuffer(url), caption, gifPlayback: true, ...options }, { quoted, ...options });
    }
    if (mime === 'application/pdf') {
      return conn.sendMessage(jid, { document: await getBuffer(url), mimetype: 'application/pdf', caption, ...options }, { quoted, ...options });
    }
    if (mime.startsWith('image/')) {
      return conn.sendMessage(jid, { image: await getBuffer(url), caption, ...options }, { quoted, ...options });
    }
    if (mime.startsWith('video/')) {
      return conn.sendMessage(jid, { video: await getBuffer(url), caption, mimetype: 'video/mp4', ...options }, { quoted, ...options });
    }
    if (mime.startsWith('audio/')) {
      return conn.sendMessage(jid, { audio: await getBuffer(url), caption, mimetype: 'audio/mpeg', ...options }, { quoted, ...options });
    }
    // default fallback as doc
    return conn.sendMessage(jid, { document: await getBuffer(url), mimetype: mime, fileName: path.basename(url), caption, ...options }, { quoted, ...options });
  };

  // ====== PROCESS SAFETY ======
  process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
  process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
}

connectToWA();
