# 🐝 Bal Vakti — Light Audit Dokümanı

> **Tarih:** 12 Ağustos 2026 · **Sürüm:** v6.5+ · **Durum:** Canlı (Vercel + Firebase)

---

## 1. Proje Yapısı

```
bal-vakti/
├── index.html          ← UI (2.816 satır — tek dosya, bilinçli seçim)
├── admin.html          ← Tanrı Modu paneli
├── api/index.js        ← MONOLİT API (~103 KB — otomatik üretilir)
├── shared/             ← Kaynak kod (bundle ile api/index.js'e derlenir)
│   ├── me.js action.js raid.js admin.js bot.js leaderboard.js
│   └── lib/ (game.js, db.js, auth.js, raidcore.js, brain.js)
├── scripts/ (bundle.js, set-webhook.js)
├── tests/ (test.js — 55 mantık testi, ui-test.mjs — Playwright)
├── server.js           ← Yerel sunucu + livereload
└── vercel.json         ← rewrites: /api/* → /api/index
```

**Mimari kararlar:**
- **Monolit API:** Vercel'in ESM yerel import sorunu nedeniyle `shared/` doğrudan deploy edilemez → `api/index.js` tek dosya
- **Tek index.html:** Telegram Mini App tek istekte açılır (39 KB gzip), statik cache dostu
- **Firebase tek DB** (Upstash kaldırıldı v5.2)

## 2. API Endpoints

| Endpoint | Metod | Açıklama |
|---|---|---|
| `/api/me` | POST | Giriş, oyuncu oluşturma, olay roll'leri (gökkuşağı/sirk/uzaylı), depo bildirimi |
| `/api/action` | POST | collect, buy_bee, upgrade, daily, spin, chest, vzvz, minigame, maze, circus, market_buy, quest_claim, throw_emoji, rename, avatar, reset_me, onboard_done |
| `/api/raid` | POST | world, start, defend, cancel, revenge |
| `/api/admin` | POST | auth, overview, search, player_update, gift, config, bot_* |
| `/api/leaderboard` | GET | all / today / week / cnt / ticker |
| `/api/bot` | POST | Telegram webhook (Telegraf) |

## 3. Güvenlik Checklist

| Kontrol | Durum | Not |
|---|---|---|
| ✅ Telegram initData HMAC doğrulaması | Tamam | auth.js — auth_date 24s limit |
| ✅ Demo gate | Tamam | `ALLOW_DEMO=1` + VERCEL_ENV≠production |
| ✅ Admin oturum (12s token) | Tamam | Redis/Firebase'te saklanır |
| ✅ Hile koruması (VızVız/oyun) | Tamam | Sunucu tarafı limitler |
| ⚠️ **Rate limiting** | **EKSİK** | API'de istek hızı sınırı yok — bot saldırısı riski |
| ⚠️ Firebase kuralları | **AÇIK** | `.read/.write: true` — gerçek kullanıcıya açmadan önce kısıtla |
| ⚠️ Admin şifre hash | **Düz metin** | ADMIN_PASSWORD env'den okunuyor; bcrypt opsiyonel |
| ✅ Token'lar koda gömülü değil | Tamam | Hepsi env |

## 4. Performans

| Metrik | Değer |
|---|---|
| index.html | 142 KB ham · **39 KB gzip** |
| api/index.js | 103 KB |
| İlk yükleme (3G) | ~1s (tek istek) |
| API yanıtı | <300ms (Firebase tek istek) |
| React migration | ❌ Gerekli değil — React runtime 45KB gzip = tüm oyunu %100+ şişirir |

## 5. Known Issues / Teknik Borç

- [ ] **Rate limiting** — en acil (oyun viral olursa abuse riski)
- [ ] **Firebase kuralları** — yayın öncesi kısıtlanmalı
- [ ] Bot AI hardcoded yatırım değerleri (admin ekonomi değişince uyumsuz)
- [ ] 82 inline `style=` (çoğu fonksiyonel display:none + modal — kademeli temizlik)
- [ ] `server.js`/`api/index.js` çift kaynak (bundle akışı unutulursa drift riski)
- [ ] Tek dosya index.html — büyüdükçe bakım zorlaşır (componentleştirme gelecekte)

## 6. Test Durumu

```
55 mantık testi ✅ (ekonomi, PvP, mini oyunlar, olaylar, görevler)
Playwright UI ✅ (7 tab, 375px, stray karakter, toast limiti, onboarding)
E2E API ✅ (sirk/oyun reddi, cap fix, quest akışı)
```

## 7. Önerilen Sıradaki Adımlar

1. 🔴 Rate limiting ekle (basit sayıcı: kullanıcı başına 30 istek/dk)
2. 🔴 Firebase kuralları (auth ile kısıtla veya sunucu-token)
3. 🟡 Admin paneli sirk/olay test tetikleyicisi
4. 🟡 Sosyal özellikler (hediye, arkadaş ziyareti)
5. 🟢 Paralel React denemesi (yalnızca ihtiyaç doğarsa)
