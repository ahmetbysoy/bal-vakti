# 🐝 Bal Vakti v3.0 — 🎰 EĞLENCE ODASI + FOMO BÜYÜSÜ Planı

> Kurgu: Kovanında bal biriktiren arılar, akşamları "Eğlence Odası"nda kumar oynar.
> Kraliçe Arı çarkı çevirir, işçi arılar yazı-tura atar, slot makinesi döner.
> Ama dikkat: arılar da kaybeder! Dünya canlı sayaçlarla nefes alır — kazananlar
> bar bar yükselir, herkes görür. FOMO garantili.

## A. 🎡 Çarkıfelek (günde 1 bedava)
- [ ] A1. game.js: `spinWheel()` — 8 dilim (0 / 50 / 100 / 250 / 500 / 1000 / x2 üretim 5dk / 25)
- [ ] A2. game.js: `spinDaily` takibi (state.lastSpin, günde 1)
- [ ] A3. action.js: `spin` aksiyonu
- [ ] A4. İstemci: çark animasyonu (CSS rotate + easing), kazanınca confetti + fanfar

## B. 🌙 Gece Etkinliği (üretim x2)
- [ ] B1. game.js: `isNight()` (22:00-06:00) + `totalProd` gece x2 çarpanı
- [ ] B2. İstemci: 🌙 rozeti "Gece Bonusu x2 Aktif!", hero'da ay görseli

## C. 🐝 Özel Arı Görünümleri
- [ ] C1. game.js: `beeEmoji(level)` — seviyeye göre farklı emoji (🐝→🦋→🦅→🐉...)
- [ ] C2. İstemci: arı grid + savaş ekranında seviyeye göre görünüm

## D. 🏆 Haftalık Lig + Bugünün Kazançları
- [ ] D1. game.js: `weeklyEarned` (state) — her kazançta işlenir
- [ ] D2. db.js: `topWeekly(n)`, `topToday(n)` — sıralamalar
- [ ] D3. İstemci: "Bu Hafta" lig sekmesi + "Bugün" canlı barlar

## E. 🎰 Eğlence Odası (kumarhane mini oyunları)
- [ ] E1. game.js: `gambleCoin(s, bet)` — yazı-tura 2x (sunucu tarafı adil rastgele)
- [ ] E2. game.js: `gambleSlot(s, bet)` — 3 emoji, 3 aynı 3x / 2 aynı 1.5x
- [ ] E3. game.js: sorumlu oyun limitleri: max bahis = balın %20'si, günlük max kayıp = 2000
- [ ] E4. action.js: `gamble` aksiyonu
- [ ] E5. İstemci: 🎰 Eğlence Odası sekmesi (yazı-tura + slot + çark)
- [ ] E6. Kaybetme/kazanma animasyonları + sesler (kazan: altın sesi, kaybet: bozuk para düşme)

## F. 📊 Canlı FOMO Paneli
- [ ] F1. İstemci: ana ekran üstü "🔥 Bugünün Kazançları" — top 3 canlı yatay barlar
- [ ] F2. Sol/sağ dikey mini sayaçlar: "⚔️ Aktif Savaş", "🎡 Bugün Çark: X", "🏆 Haftalık: Y bal"
- [ ] F3. Her kazançta bar animasyonu (canlı yükselme)

## G. 🧪 Test & Yayın
- [ ] G1. Testler: çark, gece, kumar (adillik, limitler, haftalık)
- [ ] G2. Bundle + push + canlı doğrulama
