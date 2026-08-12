# 🐝 Bal Vakti — Telegram Mini App Arı Çiftliği

Çocuklar için dopamin odaklı, eğlenceli bir Telegram mini oyunu. Para yok, sadece eğlence! 🎮

## ✨ Özellikler

- 🍯 **Pasif bal üretimi** + arı satın alma + otomatik birleştirme (10 seviye)
- 🔥 **Dopamin sistemi:** Toplama Streak (x1.2 → x3), VızVız Combo (x2 → FRENZİ x5), Level-Up patlaması
- 🎡 **Eğlence Odası:** Çarkıfelek, Günlük Sandık (jackpot!), 🎈 Balon Patlatma, ⏰ Zamanlayıcı, 🐝 Labirent
- 🌈 **Rastgele olaylar:** Gökkuşağı (%5 — üretim x2), Sirk (%3), Uzaylı + Yıldız Tozu + Galaksi Market (%1)
- ⚔️ **Bal Baskını (PvP):** Saldır, kin tut, intikam al, koalisyon kur
- 🤖 **Yapay Zekâ Arıcılar:** 6 kişilikli NPC botlar — dünya hep canlı
- 📋 **Günlük görevler** + 13 rozet + haftalık/bugünkü sıralama + kayan bant (FOMO)
- 👑 **Tanrı Modu:** oyuncu yönetimi, bot oluşturma, canlı ekonomi ayarları
- 🔐 Güvenli: Telegram initData HMAC doğrulaması, sunucu tarafı otoriteli ekonomi

## 🏗️ Mimari

```
bal-vakti/
├── index.html            ← Mini App arayüzü (tek dosya)
├── admin.html            ← Tanrı Modu paneli
├── api/index.js          ← MONOLİTİK API (otomatik üretilir — elle düzenleme!)
├── shared/               ← Kaynak kod (bundle scripti bunu api/index.js'e derler)
│   ├── me.js action.js raid.js admin.js bot.js leaderboard.js
│   └── lib/ (game.js, db.js, auth.js, raidcore.js, brain.js)
├── scripts/
│   ├── bundle.js         ← shared/ → api/index.js monolit üretici
│   └── set-webhook.js    ← Telegram webhook kurulumu
├── tests/
│   ├── test.js           ← 52 mantık testi (npm test)
│   └── ui-test.mjs       ← Playwright UI testi 375px (npm run test:ui)
├── server.js             ← yerel geliştirme sunucusu
└── vercel.json           ← rewrites: /api/* → /api/index
```

**ÖNEMLİ:** `api/index.js` otomatik üretilir (`node scripts/bundle.js`). Kod değiştirirsen `shared/` içinde değiştir, sonra bundle çalıştır ve commit'le.

## 🚀 Kurulum

### 1. Bot (BotFather)
Telegram → @BotFather → `/newbot` → token'ı al (`BOT_TOKEN`).

### 2. Vercel deploy
```bash
npm i -g vercel && vercel --prod
```
Ortam değişkenleri (Production):
| Değişken | Değer |
|---|---|
| `BOT_TOKEN` | BotFather token'ı |
| `BOT_USERNAME` | bot kullanıcı adı (@ olmadan) |
| `APP_URL` | `https://proje.vercel.app` |
| `WEBHOOK_SECRET` | rastgele uzun metin |
| `ALLOW_DEMO` | `0` (prod'da kapalı) |
| `FIREBASE_DB_URL` | Firebase RTDB adresi |
| `OWNER_ID` | Senin Telegram ID'n (botta `/admin` yazınca görürsün) |
| `ADMIN_PASSWORD` | Tanrı Modu şifresi |

> 🔑 **Güvenlik:** Vercel'de **Framework Preset = "Other"** seçilmeli! Aksi halde API'ler 404 verir.

### 3. Firebase (tek veritabanı)
[Firebase Console](https://console.firebase.google.com) → Realtime Database → Create →
URL'yi `FIREBASE_DB_URL` yap. Kurallar: `.read/.write: true` (demo; gerçek kullanıcıya açmadan önce kısıtla).

### 4. Webhook
```bash
node --env-file=.env scripts/set-webhook.js
```

### 5. Yerel geliştirme
```bash
npm start        # http://localhost:8787 (demo modu)
npm test         # 52 mantık testi
npm run test:ui  # Playwright UI testi (375px)
```

## 🎨 Kod değişikliği akışı

```bash
# shared/ içinde değişiklik yap
node scripts/bundle.js   # api/index.js'i yeniden üret
npm test                 # testler geçsin
git add -A && git commit -m "..." && git push
```

## ⚖️ Ekonomi
Tüm denge `shared/lib/game.js` başındaki `DEFAULT_CONFIG`'te. Tanrı Modu'ndan canlı değiştirilebilir (redeploy gerekmez).

## ⚠️ Notlar
- Para ödemeli değil — eğlence oyunu.
- GitHub token'larını asla repoya/sohbete yazma.
- `api/index.js` monolit — Vercel'in ESM yerel import sorunu nedeniyle `shared/` doğrudan deploy edilemez.
