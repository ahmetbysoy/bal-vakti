# 🐝 Bal Vakti v2.1 — 🤖 YAPAY ZEKÂ ARICILAR (NPC Botlar) Planı

> Kurgu: Admin bot oluşturur → her botun kişiliği/zekâsı farklı →
> botlar oyuncu gibi davranır (saldırır, kin tutar, koalisyon kurar,
> savunur) → dünya her zaman canlı, FOMO garantili.

## A. 🧠 Bot Beyni (lib/brain.js)
- [x] A1. Kişilik tanımları: 🦅 Akıllı Saldırgan, ⚔️ Savaşçı, 😤 Kindar,
      🐝 Toplulukçu, 🍯 Bal Toplayıcı, 🌀 Deli Arı
- [x] A2. Zekâ parametreleri: saldırganlık/strateji/kindarlık/sürücülük
- [x] A3. Karar ağacı: savun → intikam → koalisyon → hedef seç → saldır
- [x] A4. Hedef seçim algoritması (stratejiye göre güç aralığı)
- [x] A5. Güç seviyeleri: Zayıf/Orta/Güçlü/Efsane (arı+kovan+depo+bal)
- [x] A6. Uyanma aralığı (kişiliğe göre 2-12 dk) + lazy düşünme
- [x] A7. İsim + avatar havuzu (rastgele, her bot benzersiz)

## B. 🗄️ Veri (lib/db.js)
- [x] B1. Bot meta CRUD (bot:<id>), liste, silme (state + lb + ref temizliği)
- [x] B2. Beyin kilidi (dünya turu 60 sn'de 1 kez — race yok)

## C. ⚙️ Admin API + Panel
- [x] C1. bot_list / bot_create (adet, kişilik, güç) / bot_update / bot_delete / bot_toggle
- [x] C2. bot_run (botları hemen çalıştır — test/demo)
- [x] C3. Admin panel: 🤖 Botlar sekmesi (oluştur, listele, düzenle, sil, çalıştır)

## D. 🔌 Entegrasyon
- [x] D1. /api/me ve /api/raid world → thinkBots() (dünya oyuncu girişinde canlanır)
- [x] D2. finalizeRaid → lib/raidcore.js (brain/raid/me ortak kullanım, döngü yok)

## E. 🧪 Test & Yayın
- [x] E1. Testler: makeBotState, kişilik profilleri, hedef seçim aralıkları
- [x] E2. Push + canlı: bot oluştur, çalıştır, oyuncunun dünyasında gör
