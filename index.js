const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  jidNormalizedUser,
  isJidBroadcast,
  getContentType,
  proto,
  generateWAMessageContent,
  generateWAMessage,
  AnyMessageContent,
  prepareWAMessageMedia,
  areJidsSameUser,
  downloadContentFromMessage,
  MessageRetryMap,
  generateForwardMessageContent,
  generateWAMessageFromContent,
  generateMessageID,
  makeInMemoryStore,
  jidDecode,
  fetchLatestBaileysVersion,
  Browsers
} = require('@whiskeysockets/baileys');

const l = console.log;
const fs = require('fs');
const ff = require('fluent-ffmpeg');
const P = require('pino');
const path = require('path');
const os = require('os');
const util = require('util');
const qrcode = require('qrcode-terminal');
const StickersTypes = require('wa-sticker-formatter');
const FileType = require('file-type');
const axios = require('axios');
const { File } = require('megajs');
const { fromBuffer } = require('file-type');
const bodyparser = require('body-parser');
const Crypto = require('crypto');
const express = require('express');

const config = require('./config');
const GroupEvents = require('./lib/groupevents');
const { sms, downloadMediaMessage, AntiDelete } = require('./lib');
const { getBuffer, getGroupAdmins, getRandom, h2k, isUrl, Json, runtime, sleep, fetchJson } = require('./lib/functions');
const { AntiDelDB, initializeAntiDeleteSettings, setAnti, getAnti, getAllAntiDeleteSettings, saveContact, loadMessage, getName, getChatSummary, saveGroupMetadata, getGroupMetadata, saveMessageCount, getInactiveGroupMembers, getGroupMembersMessageCount, saveMessage } = require('./data');

// =================== BASIC CONFIG ===================
const prefix = config.PREFIX || '.';

// owners (multiple comma-separated allowed in config)
const ownerNumber = (config.OWNER_NUMBER || '923300005253')
  .split(',')
  .map(n => n.replace(/[^0-9]/g, ''));

// dev helper (owner treated as dev too)
const devNumbers = (config.DEV || ownerNumber.join(','))
  .split(',')
  .map(n => n.replace(/[^0-9]/g, ''));

// channel + assets
const CHANNEL_LINK = config.CHANNEL_LINK || 'https://whatsapp.com/channel/'; // apna link config me daalna
const MENU_IMAGE = config.MENU_IMAGE_URL || 'https://files.catbox.moe/sidq95.jpg';
const BOT_NAME = config.BOT_NAME || 'QADEER_MD';
const OWNER_NAME = config.OWNER_NAME || 'Qadeer Brahvi';

// ================== TEMP FOLDER CLEANUP ==================
const tempDir = path.join(os.tmpdir(), 'cache-temp');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
const clearTempDir = () => {
  fs.readdir(tempDir, (err, files) => {
    if (err) return;
    for (const file of files) {
      fs.unlink(path.join(tempDir, file), () => {});
    }
  });
};
setInterval(clearTempDir, 5 * 60 * 1000);

// ================== SESSION AUTH (MEGA) ==================
if (!fs.existsSync(path.join(__dirname, 'sessions/creds.json'))) {
  if (!config.SESSION_ID) {
    console.log('Please add your session to SESSION_ID env !!');
  } else {
    // NOTE: prefix changed to QADEER_MD~
    const sessdata = config.SESSION_ID.replace('QADEER_MD~', '');
    const filer = File.fromURL(`https://mega.nz/file/${sessdata}`);
    filer.download((err, data) => {
      if (err) throw err;
      fs.mkdirSync(path.join(__dirname, 'sessions'), { recursive: true });
      fs.writeFile(path.join(__dirname, 'sessions/creds.json'), data, () => {
        console.log('Session downloaded ✅');
      });
    });
  }
}

// ================== EXPRESS KEEP-ALIVE ==================
const app = express();
const port = process.env.PORT || 9090;
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`
    <h2 style="font-family:sans-serif;">${BOT_NAME} is running ⚡</h2>
    <p>Owner: <strong>${OWNER_NAME}</strong> (${ownerNumber.join(', ')})</p>
    <p>Prefix: <strong>${prefix}</strong></p>
    <p>Channel: <a href="${CHANNEL_LINK}" target="_blank" rel="noreferrer">Open</a></p>
    <img src="${MENU_IMAGE}" alt="menu" style="max-width:300px;border-radius:10px;">
  `);
});
app.listen(port, () => console.log(`🌐 Web server started on port ${port}`));

// ================== MAIN CONNECT ==================
async function connectToWA() {
  console.log('Connecting to WhatsApp ⏳️...');
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'sessions'));
  const { version } = await fetchLatestBaileysVersion();

  const conn = makeWASocket({
    logger: P({ level: 'silent' }),
    printQRInTerminal: false, // pair code flow
    browser: Browsers.macOS(BOT_NAME),
    syncFullHistory: true,
    auth: state,
    version
  });

  // --- creds persist
  conn.ev.on('creds.update', saveCreds);

  // --- connection updates
  conn.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const shouldReconnect =
        !lastDisconnect?.error ||
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) connectToWA();
      else console.log('Logged out — re-pair required.');
    } else if (connection === 'open') {
      console.log('🧬 Installing Plugins');
      fs.readdirSync('./plugins/').forEach((plugin) => {
        if (path.extname(plugin).toLowerCase() === '.js') {
          try {
            require('./plugins/' + plugin);
          } catch (e) {
            console.error('Plugin load error:', plugin, e);
          }
        }
      });
      console.log('Plugins installed successful ✅');
      console.log('Bot connected to whatsapp ✅');

      const up = `*Hello there ${BOT_NAME} User! 👋*\n\n> ${BOT_NAME} is online — Simple, Fast & Loaded with features! 🎉\n\n*Thanks for using ${BOT_NAME} ❤️*\n\n> WhatsApp Channel ⤵️\n${CHANNEL_LINK}\n\n- *PREFIX:* ${prefix}\n\n> © Powered by ${OWNER_NAME}`;
      conn.sendMessage(conn.user.id, { image: { url: MENU_IMAGE }, caption: up }).catch(() => {});
    }
  });

  // --- anti delete
  conn.ev.on('messages.update', async (updates) => {
    for (const update of updates) {
      if (update.update?.message === null) {
        try {
          await AntiDelete(conn, updates);
        } catch (e) {
          console.error('AntiDelete error:', e);
        }
      }
    }
  });

  // --- group events
  conn.ev.on('group-participants.update', (update) => GroupEvents(conn, update));

  // --- messages handler
  conn.ev.on('messages.upsert', async (mek) => {
    try {
      mek = mek.messages?.[0];
      if (!mek || !mek.message) return;

      // unwrap ephemeral
      mek.message =
        getContentType(mek.message) === 'ephemeralMessage'
          ? mek.message.ephemeralMessage.message
          : mek.message;

      // read receipt
      if (config.READ_MESSAGE === 'true') {
        await conn.readMessages([mek.key]).catch(() => {});
      }

      // viewOnce unwrap
      if (mek.message.viewOnceMessageV2) {
        mek.message =
          getContentType(mek.message) === 'ephemeralMessage'
            ? mek.message.ephemeralMessage.message
            : mek.message;
      }

      // status seen / react / reply
      if (mek.key?.remoteJid === 'status@broadcast') {
        if (config.AUTO_STATUS_SEEN === 'true') {
          await conn.readMessages([mek.key]).catch(() => {});
        }
        if (config.AUTO_STATUS_REACT === 'true') {
          const jawadlike = await conn.decodeJid(conn.user.id);
          const emojis = ['❤️', '💸', '😇', '🍂', '💥', '💯', '🔥', '💫', '💎', '💗', '🤍', '🖤', '👀', '🙌', '🚩', '🥰', '💐', '😎', '✅', '🇵🇰', '💜', '💙', '🌝', '💚'];
          const pick = emojis[Math.floor(Math.random() * emojis.length)];
          await conn.sendMessage(
            mek.key.remoteJid,
            { react: { text: pick, key: mek.key } },
            { statusJidList: [mek.key.participant, jawadlike] }
          ).catch(() => {});
        }
        if (config.AUTO_STATUS_REPLY === 'true') {
          const user = mek.key.participant;
          const text = `${config.AUTO_STATUS_MSG || '*Seen your status by QADEER_MD 🤍*'}`;
          await conn.sendMessage(user, { text, react: { text: '💜', key: mek.key } }, { quoted: mek }).catch(() => {});
        }
      }

      // persist message (your data layer)
      await Promise.all([saveMessage(mek)]).catch(() => {});

      const m = sms(conn, mek);
      const type = getContentType(mek.message);
      const content = JSON.stringify(mek.message);
      const from = mek.key.remoteJid;
      const quoted =
        type == 'extendedTextMessage' && mek.message.extendedTextMessage.contextInfo != null
          ? mek.message.extendedTextMessage.contextInfo.quotedMessage || []
          : [];
      const body =
        type === 'conversation'
          ? mek.message.conversation
          : type === 'extendedTextMessage'
          ? mek.message.extendedTextMessage.text
          : type == 'imageMessage' && mek.message.imageMessage.caption
          ? mek.message.imageMessage.caption
          : type == 'videoMessage' && mek.message.videoMessage.caption
          ? mek.message.videoMessage.caption
          : '';

      const isCmd = body.startsWith(prefix);
      const budy = typeof mek.text == 'string' ? mek.text : '';
      const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : '';
      const args = body.trim().split(/ +/).slice(1);
      const q = args.join(' ');
      const text = args.join(' ');
      const isGroup = from.endsWith('@g.us');
      const sender = mek.key.fromMe ? (conn.user.id.split(':')[0] + '@s.whatsapp.net' || conn.user.id) : (mek.key.participant || mek.key.remoteJid);
      const senderNumber = sender.split('@')[0];
      const botNumber = conn.user.id.split(':')[0];
      const pushname = mek.pushName || 'User';
      const isMe = botNumber.includes(senderNumber);
      const isOwner = ownerNumber.includes(senderNumber) || isMe;
      const botNumber2 = await jidNormalizedUser(conn.user.id);
      const groupMetadata = isGroup ? await conn.groupMetadata(from).catch(() => ({})) : {};
      const groupName = isGroup ? groupMetadata.subject : '';
      const participants = isGroup ? groupMetadata.participants || [] : [];
      const groupAdmins = isGroup ? await getGroupAdmins(participants) : [];
      const isBotAdmins = isGroup ? groupAdmins.includes(botNumber2) : false;
      const isAdmins = isGroup ? groupAdmins.includes(sender) : false;
      const isReact = m.message.reactionMessage ? true : false;

      const reply = (teks) => conn.sendMessage(from, { text: teks }, { quoted: mek });

      // ================= OWNER EVAL (% and $) =================
      const udp = botNumber.split('@')[0];
      const devList = [...new Set([udp, ...devNumbers])];
      let isCreator = devList
        .map(v => v.replace(/[^0-9]/g, '') + '@s.whatsapp.net')
        .includes(mek.sender);

      if (isCreator && budy.startsWith('%')) {
        let code = budy.slice(1).trim();
        if (!code) return reply('Provide code to run, Master!');
        try {
          let result = eval(code);
          reply(util.format(result));
        } catch (err) {
          reply(util.format(err));
        }
        return;
      }

      if (isCreator && budy.startsWith('$')) {
        let code = budy.slice(1).trim();
        if (!code) return reply('Provide async code to run, Master!');
        try {
          let result = await (async () => eval(`(async()=>{ ${code} })()`))();
          let out = util.format(result);
          if (out !== undefined) reply(out);
        } catch (err) {
          reply(util.format(err));
        }
        return;
      }

      // ================= OWNER AUTO REACT =================
      if (ownerNumber.includes(senderNumber) && !isReact) {
        const reactions = ['👑', '📊', '⚙️', '🧠', '🎯', '📈', '📝', '🏆', '🌍', '🇵🇰', '💗', '❤️', '💥', '🌼', '💐', '🔥', '❄️', '🌝', '🐥', '🧊'];
        const randomReaction = reactions[Math.floor(Math.random() * reactions.length)];
        m.react(randomReaction);
      }

      // ================= PUBLIC AUTO REACT =================
      if (!isReact && config.AUTO_REACT === 'true') {
        const reactions = [
          '🌼','❤️','💐','🔥','🏵️','❄️','🧊','🐳','💥','🥀','❤‍🔥','🥹','😩','🫣','🤭','👻','👾','🫶',
          '😻','🙌','🫂','🫀','👑','💍','🐼','🐣','🦋','🦄','🌱','🍃','🌿','☘️','🍀','🍄','🪨','🌺','🪷',
          '🌹','🌷','🌸','🌻','🌝','🌚','🌕','🌎','💫','☃️','❄️','🫧','🏆','🎯','🚀','🗿','⌛','💸','💎',
          '⚙️','📩','📦','📊','📈','📉','📂','📌','📝','🔐','🩷','🧡','💛','💚','🩵','💙','💜','🖤','🤍','🤎','✅','🚩','🇵🇰'
        ];
        const randomReaction = reactions[Math.floor(Math.random() * reactions.length)];
        m.react(randomReaction);
      }

      // ================= CUSTOM REACT (EMOJIS FROM CONFIG) =================
      if (!isReact && config.CUSTOM_REACT === 'true') {
        const reactions = (config.CUSTOM_REACT_EMOJIS || '🥲,😂,👍🏻,🙂,😔').split(',');
        const pick = reactions[Math.floor(Math.random() * reactions.length)];
        m.react(pick);
      }

      // ================= WORKTYPE/MODE =================
      if (!isOwner && config.MODE === 'private') return;
      if (!isOwner && isGroup && config.MODE === 'inbox') return;
      if (!isOwner && !isGroup && config.MODE === 'groups') return;

      // ================= COMMAND DISPATCH =================
      const events = require('./command');
      const cmdName = isCmd ? body.slice(1).trim().split(' ')[0].toLowerCase() : false;

      if (isCmd) {
        const cmd =
          events.commands.find((c) => c.pattern === cmdName) ||
          events.commands.find((c) => c.alias && c.alias.includes(cmdName));

        if (cmd) {
          if (cmd.react) conn.sendMessage(from, { react: { text: cmd.react, key: mek.key } });
          try {
            cmd.function(
              conn,
              mek,
              m,
              {
                from, l, quoted, body, isCmd, command, args, q, text, isGroup,
                sender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner, isCreator,
                groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply
              }
            );
          } catch (e) {
            console.error('[PLUGIN ERROR]', e);
            reply('⚠️ Plugin error occurred.');
          }
        }
      }

      // on: body/text/image/sticker handlers
      events.commands.map(async (command) => {
        try {
          if (body && command.on === 'body') {
            command.function(conn, mek, m, { from, l, quoted, body, isCmd, command, args, q, text, isGroup, sender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner, isCreator, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply });
          } else if (m.q && command.on === 'text') {
            command.function(conn, mek, m, { from, l, quoted, body, isCmd, command, args, q, text, isGroup, sender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner, isCreator, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply });
          } else if ((command.on === 'image' || command.on === 'photo') && m.type === 'imageMessage') {
            command.function(conn, mek, m, { from, l, quoted, body, isCmd, command, args, q, text, isGroup, sender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner, isCreator, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply });
          } else if (command.on === 'sticker' && m.type === 'stickerMessage') {
            command.function(conn, mek, m, { from, l, quoted, body, isCmd, command, args, q, text, isGroup, sender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner, isCreator, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply });
          }
        } catch (e) {
          console.error('on:* handler error', e);
        }
      });

    } catch (err) {
      console.error('messages.upsert error:', err);
    }
  });

  // ==================== UTIL HELPERS (SAME AS MAFIA STYLE) ====================
  conn.decodeJid = (jid) => {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid)) {
      let decode = jidDecode(jid) || {};
      return (decode.user && decode.server && decode.user + '@' + decode.server) || jid;
    } else return jid;
  };

  conn.copyNForward = async (jid, message, forceForward = false, options = {}) => {
    let vtype;
    if (options.readViewOnce) {
      message.message =
        message.message?.ephemeralMessage?.message
          ? message.message.ephemeralMessage.message
          : message.message;
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
    let quoted = message.msg ? message.msg : message;
    let mime = (message.msg || message).mimetype || '';
    let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
    const stream = await downloadContentFromMessage(quoted, messageType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    let type = await FileType.fromBuffer(buffer);
    let trueFileName = attachExtension ? (filename + '.' + type.ext) : filename;
    await fs.writeFileSync(trueFileName, buffer);
    return trueFileName;
  };

  conn.downloadMediaMessage = async (message) => {
    let mime = (message.msg || message).mimetype || '';
    let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
    const stream = await downloadContentFromMessage(message, messageType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
    return buffer;
  };

  conn.sendFileUrl = async (jid, url, caption = '', quoted, options = {}) => {
    try {
      let res = await axios.head(url);
      let mime = res.headers['content-type'] || '';
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
        return conn.sendMessage(jid, { audio: await getBuffer(url), caption, mime
