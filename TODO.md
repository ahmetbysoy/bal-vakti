# 🐝 Bal Vakti v2.0 — ⚔️ BAL BASKINI (PvP) Planı

> Kurgu: Saldırgan XP için savaşır, saldırıya uğrayan bal kazanır,
> kin listeleri birikir, zayıflar birleşip intikam alır, "çürüme" ile
> yarım kalan saldırılar cezalanır, bal kazancı eşiği arı ölümü tetikler.

## A. 🧮 Oyun Mantığı (lib/game.js)
- [ ] A1. **XP sistemi** — `xp` + Savaşçı Seviyesi (`warLevel`): seviye başına 50 XP
- [ ] A2. **Saldırı Gücü** — `raidPower(s)` = üretim×10 + savaşçıSv×50 + arı×5 + kovan×200
- [ ] A3. **Savaş Çözümü** — `resolveRaid(A, T, aktifSavunma)`:
      güç oranı → kazanan; XP/bal/arı kaybı/kin hesapları
- [ ] A4. **Arı Ölümü Eşiği** — savunma geliri (`defenseBal`) eşiği (2000, sonra 2×):
      aşılınca çalınan bal varsa 1 arı ölür (en düşük seviye)
- [ ] A5. **Karşılıklı Saldırı Cezası** — ikisi de birbirine saldırdıysa → ikisine −10 XP
- [ ] A6. **Koalisyon Bonusu** — aynı hedefe 10 dk içinde 2+ farklı saldırgan → herkese +5 XP
- [ ] A7. **Çürüme** — hazırlık süresi (30 sn) bitmeden vazgeçen saldırgan −10 XP

## B. 🗄️ Veri Katmanı (lib/db.js)
- [ ] B1. Aktif saldırı kaydı (hedef başına tek) — `activeRaid:<target>`
- [ ] B2. Kin listesi — `grudge:<target>` (kim saldırdı, ne zaman, sonuç)
- [ ] B3. Savaş geçmişi — `hist:<userId>` (son 20 kayıt)
- [ ] B4. Aktif saldırı indeksi — `activeRaids` set (lazy çözüm için)

## C. ⚔️ API (api/raid.js + hook'lar)
- [ ] C1. `GET world` — saldırı sekmesi: güç benzeri hedef önerileri, kin listem, aktif saldırım
- [ ] C2. `POST start` {targetId} — saldırı başlat + **kurbana Telegram bildirimi**
- [ ] C3. `POST defend` — aktif saldırıya karşı püskürt (aktif savunma ×1.25 güç)
- [ ] C4. `POST revenge` — kin listesinden intikam saldırısı
- [ ] C5. `POST cancel` — vazgeç (çürüme cezası)
- [ ] C6. **Lazy çözüm** — `/api/me` ve `/api/raid/*` girişinde süresi dolan saldırıları çöz
- [ ] C7. Sonuç bildirimleri — iki tarafa da Telegram mesajı

## D. 🎨 Arayüz (index.html)
- [ ] D1. **"⚔️ Savaş" sekmesi** (6. tab)
- [ ] D2. **Saldırı uyarı banner'ı** — hedefteysen kırmızı banner + geri sayım + 🛡️ Püskürt
- [ ] D3. Hedef listesi — güç benzeri oyuncular + 🎲 rastgele + kin listesinden seçim
- [ ] D4. **Savaş animasyonu** — 3-2-1, arı sürüleri çarpışır, sonuç modalı
- [ ] D5. **Kin listem** — kimler saldırdı + ⚔️ İntikam butonu
- [ ] D6. Savaşçı seviyesi + XP bar (header/profil)
- [ ] D7. Savaş sesleri (alarm, kazanma fanfarı, kaybetme)
- [ ] D8. Savaş geçmişi listesi

## E. 📢 Telegram Bildirimleri (api/bot.js yardımcı)
- [ ] E1. Saldırı başlarken kurbana: "⚠️ X kovanına saldırıyor!"
- [ ] E2. Sonuçta her iki tarafa: kazandın/kaybettin özeti

## F. 🧪 Test & Yayın
- [ ] F1. XP/seviye testleri, savaş çözümü testleri (kazan/kaybet/berabere/ölüm eşiği)
- [ ] F2. Push + canlı doğrulama (imzalı initData ile 2 oyuncu savaşı simülasyonu)
