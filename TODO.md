# 🐝 Bal Vakti v3.1 — 💥 BAL BOMBASI + KAYAN BANT + TASARIM Planı

> Kurgu: Arılar artık sadece bal üretmiyor — komşu kovanlara mizahi emoji
> bombaları atıyor. 💩 Poop Pelt utanç verir, 💣 Bomba ekranı sarsar,
> 🎉 Konfeti dostça kutlar. Her fırlatma dünya olayı olur, kayan bantta akar.

## A. 💥 Emoji Fırlatma (Bal Bombası)
- [ ] A1. game.js: `throwEmoji(s, targetId, emoji)` — 10 bal, 30 sn soğuma, sayaç
- [ ] A2. game.js: `THROW_EMOJIS` listesi (💩🍅🔥💣🎉🐝🍯🥊💧👑)
- [ ] A3. db.js: `addIncomingEmoji` / `getIncomingEmojis` / `clearIncomingEmojis`
- [ ] A4. action.js: `throw_emoji` aksiyonu (kaydet + tgNotify + dünya olayı)
- [ ] A5. me.js: gelen emojileri döndür + temizle
- [ ] A6. İstemci: hedeflere "💥 Fırlat" butonu + emoji seçme modalı
- [ ] A7. İstemci: gelen emoji animasyonu (uçar → çarpar → 3 zıplama + her zıplamada haptic)

## B. 📜 Kayan Bant (Ticker)
- [ ] B1. index.html: header'ı kaldır → üstte CSS marquee (sürekli akan)
- [ ] B2. leaderboard.js: `mode=ticker` (events + counters + today top)
- [ ] B3. İstemci: renderTicker — olaylar + kazançlar + savaşlar akar
- [ ] B4. 15 sn'de bir tazele

## C. 🎨 Ana Ekran Tasarımı
- [ ] C1. Hero: bal damlası animasyonları, glow'lu bal sayacı, daha canlı gradyan
- [ ] C2. Nav şıklaştırma + hero'ya küçük 👥 Davet butonu
- [ ] C3. Arka plan animasyonu (yüzen baloncuklar)
- [ ] C4. Kovan sekmesinde FOMO paneli + ticker uyumu

## D. 🔊 Ses & Efekt
- [ ] D1. Sfx.throw (fırlatma), Sfx.splat (çarpma), zıplamada tick
- [ ] D2. Ekran shake (çarpma anında)

## E. 🧪 Test & Yayın
- [ ] E1. Testler: throwEmoji maliyet/soğuma/limit
- [ ] E2. Bundle + push + canlı doğrulama
