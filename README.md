# 🐝 Bal Vakti — Telegram Mini App Arı Çiftliği Oyunu

Honey Farm tarzı ama **daha eğlenceli, daha basit ve 100% ücretsiz** bir Telegram oyunu.
Para ödemesi YOK — amaç eğlenceli zaman kaybetmek! 🎮

## ✨ Özellikler

- 🍯 **Pasif bal üretimi** — arılar sen uğraşmasan da bal üretir (depo dolunca durur!)
- 🐝 **Arı satın alma + otomatik birleştirme** — 2 aynı seviye arı = 1 üst seviye (12 seviye, üretim 3x katlanır)
- 🏭 **Yükseltmeler** — Kovan (üretim x2) ve Depo (kapasite x4)
- 🎁 **Günlük ödül serisi** — 7 gün boyunca artan ödüller, seriyi bozma!
- ⚡ **VızVız mini oyunu** — 10 saniyede arıya dokun, bal kazan (5 dk bekleme)
- 🏅 **13 rozet** — "İlk Arı"dan "Bal Milyoneri"ne, "Hız Canavarı"ndan "Efsane Kovan"a
- 👥 **Davet sistemi** — arkadaşını çağır: sana +100, ona +50 bal
- 🏆 **Liderlik tablosu** — arkadaşlarınla yarış
- 🔐 **Güvenli** — Telegram initData HMAC doğrulaması, tüm ekonomi sunucu tarafında, hile koruması

## 🏗️ Mimari

```
bal-vakti/
├── index.html            ← Mini App arayüzü (tek dosya, harici kaynak yok)
├── api/
│   ├── me.js             ← POST /api/me — giriş, oyuncu oluşturma, davet ödülü
│   ├── action.js         ← POST /api/action — collect/buy/upgrade/daily/vzvz
│   ├── leaderboard.js    ← GET /api/leaderboard — en iyi 30 arıcı
│   └── bot.js            ← POST /api/bot — Telegram webhook (Telegraf)
├── lib/
│   ├── game.js           ← oyun mantığı (saf fonksiyonlar, denge ayarı burada)
│   ├── db.js             ← Upstash Redis (prod) + bellek modu (dev)
│   └── auth.js           ← initData doğrulaması
├── scripts/set-webhook.js ← webhook + menü butonu kurulumu
├── tests/test.js         ← 15 otomatik test (npm test)
└── server.js             ← yerel geliştirme sunucusu
```

**Neden Mini App?** Telegram botları butonla oyun oynamak için hantal. Mini App,
bot içinde açılan tam ekran web uygulaması — Honey Farm'ın kendisi de böyle.
Vercel'e tek projede sığar: statik sayfa + serverless API + bot webhook'u.

## 🚀 Kurulum (adım adım)

### 1. Botu oluştur (2 dk)
1. Telegram'da [@BotFather](https://t.me/BotFather) → `/newbot`
2. Ad: `Bal Vakti` → kullanıcı adı: `bal_vakti_bot` gibi
3. Sana verilen **token'ı** kopyala. Kullanıcı adını da not et.

### 2. Deploy et (Vercel, 5 dk)
```bash
npm i -g vercel
cd bal-vakti
vercel          # ilk seferde hesap girişi ister → deploy
vercel --prod   # kalıcı adres için
```
Sonuçta şöyle bir adres alacaksın: `https://bal-vakti.vercel.app` — buna **APP_URL** diyelim.

### 3. Ortam değişkenlerini gir
Vercel paneli → Proje → **Settings → Environment Variables** (Production):

| Değişken | Değer |
|---|---|
| `BOT_TOKEN` | BotFather'dan aldığın token |
| `BOT_USERNAME` | botun kullanıcı adı (örn. `bal_vakti_bot`) |
| `APP_URL` | `https://bal-vakti.vercel.app` |
| `WEBHOOK_SECRET` | kendin uydur (uzun, rastgele metin) |
| `ALLOW_DEMO` | `0` (prodüksiyonda kapalı!) |
| `UPSTASH_REDIS_REST_URL` | aşağıda → |
| `UPSTASH_REDIS_REST_TOKEN` | aşağıda → |

Sonra **Redeploy** et (Deployments → ⋯ → Redeploy).

### 4. Veritabanı (ücretsiz, 3 dk) — verilerin kalıcı olması için şart
1. [console.upstash.com](https://console.upstash.com) → ücretsiz kayıt → **Create Database**
2. Database name: `bal-vakti` → Region: `eu-central-1` → Create
3. **Rest API** sekmesinden `UPSTASH_REDIS_REST_URL` ve `UPSTASH_REDIS_REST_TOKEN` değerlerini yukarıya kopyala.

> 💡 Upstash olmadan da çalışır ama Vercel'de her yeniden dağıtımda veriler sıfırlanır.

### 5. Webhook'u kur (1 dk)
```bash
cp .env.example .env   # değerleri doldur
node --env-file=.env scripts/set-webhook.js
```
Bu script: webhook'u bağlar, sohbet kutusuna **"🎮 Oyna"** menü butonunu ekler, komutları tanımlar.

### 6. Bitir! 🎉
Telegram'da botunu aç (`/start`) → **🎮 Oyna** → oyun başladı!

## 🐙 GitHub'a push

```bash
cd bal-vakti
git init && git add -A && git commit -m "🐝 Bal Vakti v1.0"
# seçenek A: gh CLI
gh repo create bal-vakti --public --source . --push
# seçenek B: manuel
git remote add origin https://github.com/KULLANICI_ADIN/bal-vakti.git
git push -u origin main
```
Sonra Vercel'de **Import Project → GitHub** ile bağlayabilirsin (otomatik deploy).

## 💻 Yerel geliştirme

```bash
npm install
npm start              # → http://localhost:8787 (demo modu, veriler bellek + localStorage'da)
npm test               # 15 mantık testi
```
Tarayıcıda açınca oyun çalışır (sunucuya bağlanamazsa otomatik önizleme modu).
Telegram'da denemek için webhook'u yerel sunucuya yönlendirmek yerine (https şart)
[ngrok](https://ngrok.com) + `setWebhook` scriptini APP_URL=ngrok adresiyle çalıştırabilirsin.

## ⚖️ Dengeyi değiştirmek

Tüm sayılar `lib/game.js` başındaki sabitlerde:
- `BEE_BASE_COST` / `BEE_COST_GROWTH` — arı fiyatı
- `P1` / `P_MULT` — üretim
- `CAP_BASE` / `CAP_UPG_MULT` — depo
- `KOVAN_BASE` / `KOVAN_COST_MULT` — kovan
- `DAILY_REWARDS` — günlük ödüller
- `VIZVIZ_*` — VızVız ayarları

## 🧪 Testler

```bash
npm test
# 15 test: üretim, birleştirme kaskadı, kapasite sınırı, günlük seri,
# VızVız hile koruması, rozet koşulları, seviye sistemi...
```

## ⚠️ Notlar

- Para ödemeli **değil** — eğlence oyunu. Telegram bot politikaları ve yasal riskler için
  gerçek para akışı eklemeden önce araştırma yap.
- `ALLOW_DEMO=1` yalnızca geliştirmede kalsın; prodüksiyonda `0` yap.
- Her oyuncunun tüm durumu Redis'te tek JSON olarak saklanır — küçük kullanıcı sayısı için ideal.

## 📄 Lisans

Serbestçe kullan, çatalla, geliştir. 🐝
