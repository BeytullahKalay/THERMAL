# THERMAL — Narrative Intensification Plan

> **Amaç:** ER'ı gerçek **çekirdek mekaniğe** dönüştür, arka hikayeyi vurucu hâle getir, işçi ölümlerinde gerçek ağırlık yarat. Tartışılacak — kod yok, sadece plan.

---

## 1. Tanı (mevcut durum)

| Alan | Şu an | Sorun |
|---|---|---|
| ER frekansı | ~1-2/shift | Çekirdek tema (manual yalanı) **yaşanmıyor** |
| ER ↔ hikaye | Bağsız | Kod fix olur, hikaye akmaz |
| İşçi karakteri | ID + isim | Anonim ölüyorlar |
| Predecessor log | Pasif okuma | Tek seferlik briefing, sonra kayıp |
| Arka hikaye | News + log dosyalarında dağınık | Oyuncu birleştirmiyor |

---

## 2. Araştırma — referans oyunlardan dersler

### Papers, Please (Lucas Pope)
**Bulgular:**
- Sistemik tekrar: aynı tip karar onlarca farklı bağlamda → moral ağırlık birikir
- Küçük güç + büyük yük = **"iron cage"** hissi
- Kararlar haberlere yansır (zaten yaptık)

**THERMAL uygulaması:** ER'i bu tekrar-eden ahlaki dolaşımın merkezi yap. Her ER bir mikro-yargı: prosedürü mü uyguluyorsun, yoksa içgüdünü mü dinliyorsun.

### Return of the Obra Dinn (Lucas Pope)
**Bulgular:**
- **Validation in sets of 3** → oyuncu üç parça tutmadan onay alamaz, derin engagement
- Saf gözlem ve tümdengelim — envanter/dialog yok
- Her ölüm donmuş dramatik tablo
- Manuel = "katalogdan seç" değil, **bağlamdan çıkar**

**THERMAL uygulaması:** Her ER 4 alt-koşul. Bunlar **gözlem birimleri** gibi davransın. ER bittiğinde *"Bunu nereden öğrendim?"* sorusunun cevabı predecessor logunda olsun.

### This War of Mine (11 bit)
**Bulgular:**
- **Karakter biyografisi** = duygusal bağlanma anahtarı. Oversimplified karakterler = umursamaz oyuncu.
- **"Our Things" / "Inventory" değil** — sözcük seçimi karakterleştiriyor
- **Subtle semboller** (sallanan ayaklar = intihar) > grafik şiddet
- Çocuk karakterler = en güçlü kırılganlık vektörü
- Oyuncu **kendi eylemini düşünür**, oyun emosyon zorlamaz

**THERMAL uygulaması:**
- Her 10 işçiye **portre + 1 satır biyografi + 1 ses replikası** (ilk dispatch'te söyler)
- "WORKER" → "OPERATOR [NAME]"
- Ölünce: bir **kişisel eşya** geride bırakır (fotoğraf, çizim, kaset). Sonraki vardiyada FILES'a düşer.
- Aile mektupları her işçi için **unique** (template havuzu değil)
- "Survived but FLAGGED" = 2 vardiya yok, döndüğünde yaşlanmış görünür ("He's not the same")

### Chernobyl: Simulator (Steam)
**Bulgular:**
- Gerçek VIUR paneli + pre-disaster RBMK manuelinden prosedürler
- Authentic = ağırlık verir

**THERMAL uygulaması:** Manuel'in "yanlış" sayfalarının ALL stratejik — gerçek Chernobyl operatörünün yaşadığı "AZ-5 düğmesine bastım, daha kötü oldu" anına ipucu olsun. Bir ER'da manuel yalanı = bir gerçek kazaya gönderme.

---

## 3. Plan — 3 dikey eksen

### A. ER as Central Mechanic

**Hedef:** Vardiya başına 4-6 ER. Her biri hikaye taşır.

- **A1.** ER spawn rate'i tekrar tighten: `firstMs` 60s→40s, `respawnMs` 100s→70s.
- **A2.** Her ER'a **bağlı işçi** ata: `{ code: "ER-204", boundWorker: "w03", title: "DMITRY'S LOOP" }`. ER UI o işçinin adını + portresini gösterir.
- **A3.** ER outcomes işçiyi etkilesin:
  - **FIXED in time** → bound worker'a `+$2 hazard pay`
  - **FIXED slow** (>60s) → bound worker dose `+0.05`
  - **NOT FIXED** (ER lapses, başka mekanik) → bound worker dose `+0.20`, log: *"Dmitry was in that loop when it tripped."*
- **A4.** **Forced manual-lie tutorial** (shift 1 birinci ER): manuel açıkça **yanlış** prescription verir. Çözüm predecessor handover note'unda → oyuncu öğrenir: *"Manuel her zaman doğru değil. Bunu unutma."*
- **A5.** **ER chain (3 ER across run)** belirli bir backstory thread anlatır. Örn: ER-204 (shift 2) → ER-208 (shift 4) → ER-211 (shift 6) hepsi aynı loop'un kademeli arıza zinciri. Predecessor bunu bilmiş, kazada ölmüş.

### B. Arka hikaye dramatizasyonu

**Hedef:** Oyuncu vardiya başı/sonu küçük dramatik dozlarla hikayeyi içselleştirsin.

- **B1.** Her vardiya açılışta **3 saniyelik scripted hook**: bir log satırı yazılır CRT'ye, sonra game başlar. Örn:
  - Shift 1: `// 21:58 — KOWALSKI'NİN SON SAYFASI BURADA KESİLİYOR.`
  - Shift 4: `// MANUEL REVISION 2018.04 — BIR ŞEY DEĞIŞTI AMA NE?`
  - Shift 7: `// SEN BU SANDALYEDEN KAÇ KEZ KALKACAĞIN BIR GECEDE TUTULMUŞ.`
- **B2.** **Predecessor (OP.17) handover note interaktif olsun.** Her vardiya sonu oyuncu kendi notunu ekleyebilir (1-2 satır seçenek). Bu birikim shift 7 ending'inde geri okunur.
- **B3.** **Manual revision olayı (B'nin merkezi)**: shift 6'da manuel "REV 2018.05" pushlanır. Aslında prescription'lar **bilerek** yanlış yapıldı — bir önceki kazayı örtbas için. Predecessor bunu öğrendi → susturuldu (OP.17 ölüm haberi shift 3-5 arası, **artık explicit** bağlanır).
- **B4.** **Shift 7 reveal**: son ER'da manuel ile predecessor note arasında **direkt çelişki**. Oyuncu seçer: manuel mi, OP.17 mi? Doğru cevap OP.17 — manuel uygulayan meltdown alır. Bu **final ahlaki test**.

### C. İşçi karakterleri — duygusal ağırlık

**Hedef:** İşçi öldüğünde dize çöksün. Sayı değil, isim olsun.

- **C1.** 10 işçi her birine:
  - **Portre** (zaten var: `*.txt`)
  - **1 satır biyografi** (yeni): "Köyde küçük bir bahçesi var. Kızı 7 yaşında."
  - **1 ses replikası** (ilk dispatch'te söyler): "İlk gece misin? Korkma. Önce dinle, sonra konuş."
- **C2.** Yeni **PERSONNEL panel** (home-terminal'de yeni sekme veya FILES alt-section). 10 işçi listelenir, ölü olanlar üstü çizili. Aktif olanların biyo + dose + son dispatch tarihi görünür.
- **C3.** **Wording revision**: oyun genelinde "WORKER" / "OPERATOR" → "OPERATOR [NAME]". Dispatch overlay'de "ROLE: TRAINEE" → "ALEKSEI — TRAINEE — 26".
- **C4.** **Kişisel eşya bırakma**: ölünce roster'a `{leftBehind: 'a photo of his daughter'}` yazılır. Sonraki vardiya FILES sekmesinde tek satır: `// FOUND IN LOCKER 5 — A photo of his daughter.`
- **C5.** **Unique family letters**: 10 işçi → 10 farklı mektup. Template pool kaldırılır. Her mektup işçinin biyografisinden örgülenir.
- **C6.** **"Survived but FLAGGED" mekaniği genişler:**
  - >1.5 Sv olunca worker bench'lenir (var)
  - +2 vardiya sonra döner — ama biyografisi güncellenir: *"He's quieter now."*
  - Dose max'ı düşer (2.0 yerine 1.7) — daha kolay ölür
  - Dispatch'te ek replika: *"…it's fine. I'm fine."* (oyuncu yalan olduğunu bilir)

---

## 4. Önceliklendirme ve tahmini iş

| Öncelik | Eksen | Tahmini saat | Etki |
|---|---|---|---|
| 1 | A1+A4 (ER tighten + shift 1 manual-lie tutorial) | 2-3h | **EN YÜKSEK** — çekirdek tema yaşanmaya başlar |
| 2 | C1+C3+C5 (biyografiler + wording + unique letters) | 4-6h | Duygusal ağırlık ciddi sıçrar |
| 3 | A2+A3 (ER↔worker binding + outcome effects) | 3-4h | ER her seferinde küçük bir hikaye olur |
| 4 | B1+B2 (shift hooks + interaktif note) | 3-4h | Hikaye sürekli akar |
| 5 | C4+C6 (left-behind item + FLAGGED genişler) | 3-4h | Polish + dramatizasyon |
| 6 | A5+B3+B4 (3-ER chain + final reveal) | 5-7h | Hikayeyi **bitirir** — payoff |
| 7 | C2 (PERSONNEL panel) | 2-3h | Sürekli görünür hesap |

**Toplam:** ~22-31 saat.

---

## 5. Tartışılacak açık sorular

1. **PERSONNEL panel** ayrı sekme mi yoksa FILES içinde alt-section mı? (Sekme = daha görünür, alt-section = daha bürokratik)
2. **10 işçi biyografisi tonu** — gerçekçi soğuk mu (TWoM tarzı), yoksa daha samimi mi (Disco Elysium tarzı)?
3. **Forced manual-lie tutorial** shift 1'de — çok mu didaktik (oyuncu "tamam anladım, manuel yalan söyler" der)? Yoksa daha subtle keşfedilsin mi shift 3-4'te?
4. **A5'in 3-ER chain backstory thread**'i bir **özel hikaye** mi olsun (örn. "Kowalski'nin son vardiyasındaki kaza"), yoksa **prosedural mi**?
5. **Interaktif note (B2)** — oyuncu gerçekten yazacak mı, yoksa preset seçenekler mi? Yazma riski: cringe. Preset: limitli.
6. **C6 FLAGGED return** — 2 vardiya doğru aralık mı? Daha kısa, oyuncu "az ceza" der; daha uzun, unutur.

---

## 6. Bu plan dışı bıraktıklarım

- Yeni mini-game eklemek (mevcut 5 yeterli — polish yaptık)
- Achievement havuzu büyütmek (mevcut 14 yeterli)
- Multi-language extension (mevcut 6 dilde tutuyoruz; yeni narrative content EN-only deploy → contractor pass)

---

## 7. Sıradaki adım

Sen oku, **hangi maddeler hangi sırayla** dersin. Sıra netleşince kod sprint'ine geçeriz.
