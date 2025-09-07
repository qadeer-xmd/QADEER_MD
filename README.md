<p align="center">
  <img src="https://files.catbox.moe/7nf8cb.jpg" width="300" height="300"/>
</p>

<h1 align="center">⚡ QADEER_MD ⚡</h1>
<h3 align="center">Your All-In-One Stylish WhatsApp Bot 🚀</h3>

<p align="center">
  <a href="https://github.com/qadeer-xmd/QADEER_MD"><img src="https://img.shields.io/badge/Version-1.0.0-blue.svg" /></a>
  <a href="#"><img src="https://img.shields.io/badge/Maintained-Yes-green.svg" /></a>
  <a href="#"><img src="https://img.shields.io/badge/Language-JavaScript-yellow.svg" /></a>
</p>

---

## ✨ Features
- ✅ Auto Sticker  
- ✅ Auto React & Custom Emojis  
- ✅ Anti Delete / Anti ViewOnce  
- ✅ Group Management Tools  
- ✅ Menu with Stylish UI  
- ✅ Always Online / Auto Typing / Recording  
- ✅ Status Seen + Auto Reply  
- ✅ Fun Commands + Downloader Tools  

---

## 🔥 Deploy Instructions

### 1️⃣ Get SESSION_ID
1. Open [Pairing Site](https://long-otha-anayatking-3e195191.koyeb.app/)  
2. Pair with your WhatsApp  
3. Copy the generated **SESSION_ID**  

---

### 2️⃣ Deploy to Koyeb (Recommended)
- Fork this repo  
- Go to [Koyeb Dashboard](https://app.koyeb.com/)  
- Create new service → Link GitHub Repo  
- Select **Dockerfile** build  
- Add Environment Variables:  
  - `SESSION_ID=xxxxxxxxxx`  
  - `OWNER_NUMBER=923xxxxxxx`  
  - `BOT_NAME=QADEER_MD`  

---

### 3️⃣ Deploy to Heroku
- Connect GitHub repo in Heroku  
- Add buildpacks:  
  - `heroku/nodejs`  
- Set same Environment Variables (SESSION_ID, OWNER_NUMBER, BOT_NAME)  
- Deploy branch → Done ✅  

---

### 4️⃣ Run in Termux (Optional)
```bash
pkg update && pkg upgrade -y
pkg install git nodejs ffmpeg imagemagick -y
git clone https://github.com/qadeer-xmd/QADEER_MD
cd QADEER_MD
npm install
node index.js
