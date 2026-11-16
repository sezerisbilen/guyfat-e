# 🎧 guyfat-e

Oyun oynarken arkadaşlarınla konuşman için bir sesli sohbet programı.

- Ses **doğrudan kişiler arasında** (WebRTC, P2P) iletilir. Sunucu yalnızca bağlantıyı kurar ve ses ondan geçmez.
- Mikrofonun iki modu var: **Ses algılama** (önerilen) ve **Hep açık**. Gürültü engelleme ve yankı giderme de var.
- Herkesin sesini ayrı ayrı ayarlayabilirsin. Kişilerin ping değerleri ve kimin konuştuğu görünür.
- Odaya şifre koyabilir, davet linki gönderebilirsin.
- Oyun içindeyken de çalışan kısayollar:
  - **Ctrl+Shift+M** mikrofonu kapatır ya da açar.
  - **Ctrl+Shift+D** sesi tamamen kapatır ya da açar.
- Pencereyi kapatınca program saatin yanındaki sistem tepsisinde çalışmaya devam eder. Tamamen kapatmak için tepsideki simgeye sağ tıklayıp **Çık**'ı seç.

## Kurulum (Windows)

- `guyfat-e-Kurulum-1.4.0.exe`: Programı bilgisayara kurar ve masaüstüne kısayol ekler.
- `guyfat-e-Tasinabilir-1.4.0.exe`: Kurulum yapmadan doğrudan çalışır.

> Program dijital olarak imzalı olmadığı için Windows ilk açılışta "Windows bilgisayarınızı korudu" uyarısı gösterebilir.
> **Ek bilgi → Yine de çalıştır** seçeneğiyle açabilirsin.

## Kullanım

Program, her zaman açık olan ortak sunucuya (`https://sesli-sohbet-ssnz.onrender.com`, Render.com) kendiliğinden bağlanır. Adres yazmaya gerek yok.

1. Takma adını yaz.
2. **Odalar** listesinden bir odaya tıkla. Odanın altında o an içeride kimlerin olduğu görünür.

**"oturma odası"** kalıcı bir odadır: içinde kimse olmasa da listede durur. Kalıcı odalar sunucudaki `PERMANENT_ROOMS` ortam değişkeniyle değiştirilebilir (virgülle ayrılmış oda adları). Başka bir oda açmak için **Başka bir oda aç**'a tıklayıp oda adını yaz; bu odalar içi boşalınca listeden kalkar.

> Ücretsiz sunucu 15 dakika kullanılmayınca uyur. O sırada ilk giren kişi "Sunucu uyanıyor…" mesajını görür ve ~1 dakika bekler. Sonrası normaldir.

Programı kurmayan biri https://sesli-sohbet-ssnz.onrender.com adresini ya da davet linkini tarayıcıda açarak da (Chrome, Edge, Firefox) katılabilir.

### Kendi bilgisayarında sunucu açmak (isteğe bağlı)

Ortak sunucu yerine kendi sunucunu kullanmak istersen programda **"🖥️ Bu bilgisayarda sunucu aç"** düğmesine bas. Program `https://xxxx.trycloudflare.com` gibi geçici bir adres verir. Bu adresi arkadaşların **Sunucu adresi** alanına yapıştırır. Adres, sunucu her açıldığında değişir.

### İpuçları

- Arka plan sesin karşıya gidiyorsa alttaki sarı kaydırıcıyla hassasiyeti düşür. Yeşil çubuk sarı çizgiyi geçtiğinde sesin gönderilir.
- Kulaklık kullanmak yankıyı tamamen önler.
- Mikrofonu ve kulaklığı **⚙️ Ayarlar**'dan seçebilirsin.

## Bir arkadaşın bağlanamıyorsa (TURN sunucusu)

Bir kişinin kartında "Bağlanamadı (TURN gerekebilir)" yazıyorsa ağ doğrudan bağlantıya izin vermiyordur. Bu genelde bazı mobil hatlarda ve CGNAT kullanan ev internetlerinde olur. Böyle durumlarda sesi bir TURN sunucusu aktarır.

1. https://www.metered.ca/tools/openrelay/ adresinden ücretsiz bir hesap aç, kullanıcı adı ve şifre al.
2. Sunucuyu **komut satırından** şu ayarlarla başlat (bkz. aşağıdaki bölüm):

```powershell
$env:TURN_URL="turn:sunucu.adresi:3478"; $env:TURN_USER="kullanici"; $env:TURN_PASS="sifre"; npm run server
```

## Geliştiriciler için

```bash
npm install
```

Programı geliştirme modunda açmak için:

```bash
npm start
```

Yalnızca sunucuyu çalıştırmak için (VPS gibi bir makinede, http://localhost:3000 üzerinde):

```bash
npm run server
```

Windows kurulum dosyasını yeniden oluşturmak için (dosyalar `dist/` klasörüne çıkar):

```bash
npm run dist:win
```

macOS ve Linux için `npm run dist:mac` ve `npm run dist:linux` komutları kullanılır. macOS paketi yalnızca bir Mac üzerinde oluşturulabilir.

| Ortam değişkeni | Varsayılan | Açıklama |
|---|---|---|
| `PORT` | 3000 | Sunucu portu (`npm run server` için) |
| `MAX_PER_ROOM` | 10 | Bir odadaki en fazla kişi sayısı |
| `ACCESS_CODE` | – | Giriş kodu. Ayarlıysa kodu bilmeyen oda listesini göremez ve odaya giremez |
| `PERMANENT_ROOMS` | oturma odası | Boşken de listede duran kalıcı odalar (virgülle ayrılır) |
| `TURN_URL`, `TURN_USER`, `TURN_PASS` | – | İsteğe bağlı TURN sunucusu |
