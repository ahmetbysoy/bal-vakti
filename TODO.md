# 🐝 Bal Vakti v1.1 — İyileştirme Planı (TODO)

> Plan: önce bağlantı sorununu çöz, sonra profil + ayarlar + ses.
> Durum: `[ ]` yapılacak · `[x]` tamam

## A. 🔌 Bağlantı / "Önizleme Modu" Sorunu
- [x] **A1. Teşhis** — canlı test: token geçerli, imzalı initData 200 OK, Upstash bağlı, ALLOW_DEMO kapalı
  → Sorun sunucuda DEĞİL; oyun Telegram dışından (tarayıcı/önizleme) açılınca initData gelmiyor → demo modu
- [x] **A2. Önizleme mesajı netleştir** — "sunucuya bağlı değil" yerine açıklayıcı yazı:
  "🔌 Önizleme modu — Telegram'da @bal_vakti_bot → 🎮 Oyna ile gerçek oyunu aç"
- [x] **A3. "Sunucuya Bağlan" butonu** — demo modundayken manuel yeniden bağlanma denemesi
- [x] **A4. Düşüş sebebini göster** — demo'ya geçerken neden (initData yok / auth hatası / ağ) ufak not olarak

## B. 👤 Profil
- [x] **B1. Header'da isim** — kullanıcı adı + seviye başlığı görünsün
- [x] **B2. "Ben" sekmesi** (nav'a 👤 ekle) — profil kartı: emoji avatar, isim, seviye/başlık, ID
- [x] **B3. İstatistikler** — toplam bal, arı sayısı, rozet sayısı, davet sayısı, VızVız sayısı, hesap yaşı
- [x] **B4. İsim değiştirme** — sunucuda kalıcı kayıt (state.name), liderlik tablosuna yansır
- [x] **B5. Avatar seçici** — emoji listesinden seç (state.avatar, kalıcı)

## C. ⚙️ Ayarlar (Ben sekmesi içinde)
- [x] **C1. Ses efektleri** — Web Audio ile dosyasız üretim:
  tıklama / topla / satın al / birleştir / rozet fanfarı / hata / VızVız vızıltısı
- [x] **C2. Ses aç-kapa** — localStorage'da kalıcı (varsayılan açık)
- [x] **C3. Titreşim aç-kapa** — HapticFeedback kontrolü, kalıcı
- [x] **C4. Hesabı sıfırla** — onay kutusu + sunucuda sıfırlama (isim/avatar korunur)
- [x] **C5. Hakkında** — sürüm, kısa açıklama

## D. 🖥️ Sunucu (API)
- [x] **D1. api/action: `rename`** — isim güncelle (temizlik + uzunluk limiti)
- [x] **D2. api/action: `reset_me`** — oyuncu kendi hesabını sıfırlar
- [x] **D3. api/action: `avatar`** — avatar emoji güncelle (tek emoji doğrulaması)

## E. 🧪 Test & Yayın
- [x] **E1. Testler güncelle** (yeni aksiyonlar için)
- [x] **E2. Push + canlı doğrulama** (imzalı initData ile uçtan uca)
