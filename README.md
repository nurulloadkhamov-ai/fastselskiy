# Fast Education — adolatli baholash tizimi

Ustozlar, xodimlar va filiallar ishini baholash uchun veb-sayt.

- **Sayt:** https://nurulloadkhamov-ai.github.io/fastselskiy/
- **Ma'lumotlar bazasi:** Supabase (`setup.sql`)

## Birinchi sozlash (bir marta)

1. Supabase → **SQL Editor** → **New query**. `setup.sql` faylini to'liq qo'yib, **Run** bosing.
2. Saytga `admin` / `fast2026` bilan kiring va **Profil** bo'limida parolni darhol o'zgartiring.
3. **Admin panel → Login-parollar** bo'limida har bir ustoz va xodimga login bering.

## Rollar

| Rol | Nima qila oladi |
|---|---|
| Admin (menejer) | Hamma narsa: baholash, shikoyatlar, topshiriqlar, vazifalar, loginlar, sozlamalar |
| Ustoz | Reytingni, o'z profilini, o'ziga kelgan shikoyatlarni ko'radi; o'z topshiriqlarini "bajarildi" deb belgilaydi |
| Xodim | Faqat o'zining bugungi vazifalarini belgilaydi (kechikish server vaqti bo'yicha hisoblanadi), o'z topshiriqlarini yuritadi |

## Fayllar

- `index.html`, `style.css`, `app.js` — sayt
- `config.js` — Supabase manzili va publishable kalit
- `setup.sql` — jadvallar, xavfsizlik qoidalari va server funksiyalari

## Telegram bot

Bot Supabase Edge Function sifatida ishlaydi (`supabase/functions/telegram/index.ts`).

1. Telegram'da **@BotFather** → `/newbot` → nom va username bering → **tokenni** saqlang.
2. Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor** → nomi `telegram` → `index.ts` matnini qo'ying → **Deploy**. Keyin funksiya sozlamalarida **Verify JWT** ni o'chiring.
3. Supabase → **SQL Editor**: `telegram.sql` ni to'liq ishga tushiring, keyin alohida: `select public.tg_setup('BOT_TOKEN');`
4. Tekshirish: `select public.tg_status();` — `"webhook": "ok"` chiqishi kerak.
5. Har bir foydalanuvchi: sayt → **Profil** → **Telegramni ulash**.

| Kim | Nima keladi |
|---|---|
| Xodim | 07:00 kunlik vazifalar ro'yxati (tugma bilan belgilash), har bir vazifa vaqtida eslatma, 20:30 kun yakuni, dushanba haftalik natija |
| Ustoz | Yangi topshiriq, dars bahosi, menejer bahosi, tasdiqlangan shikoyat; dushanba ball va o'rin |
| Menejer | 20:30 kunlik hisobot (filiallar, xodimlar, shikoyatlar, muddati o'tganlar), dushanba to'liq reyting, yangi shikoyat va bajarilgan topshiriqlar; `/ustoz ism`, `/xodimlar`, `/shikoyatlar` |

## Murojaatlar va xabarlar

`messages.sql` ni SQL Editor'da bir marta ishga tushiring (setup.sql va telegram.sql dan keyin).

- **Ustoz / xodim → menejer:** saytda «Xabarlar → Menejerga yozish» (muammo yoki taklif, xohlasa anonim) yoki botga oddiy xabar yozish / `/murojaat`.
- **Menejer:** «Xabarlar → Murojaatlar» — javob yozish, holat (Yangi / Ko'rib chiqilmoqda / Hal qilindi). Botda yangi murojaat tugmalar bilan keladi: «Javob yozish», «Hal qilindi»; `/murojaatlar`.
- **Menejer → xodimlar:** «Xabarlar → Xabar yuborish» — hammaga, ustozlarga, xodimlarga, filialga, lavozimga yoki bitta odamga; kim o'qiganini ko'rasiz. Botda `/xabar`.

## Filial adminlari

`branch_admin.sql` ni SQL Editor'da bir marta ishga tushiring (oldingi barcha SQL fayllardan keyin).

- **Bosh admin** (filial tanlanmagan) — hamma filiallarni boshqaradi, sozlamalar va filial qo'shish faqat unda.
- **Filial admini** — Admin panel → Login-parollar → Rol: «Admin», «Qaysi filial»: kerakli filial. U faqat o'z filialining ustozlari, xodimlari, baholari, shikoyatlari, vazifalari, topshiriqlari, login-parollari, murojaatlari va xabarlarini boshqaradi. Cheklov serverda tekshiriladi: boshqa filial ma'lumotini o'zgartirishga urinish e'tiborsiz qoladi.
- Botda filial admini hisobot va bildirishnomalarni faqat o'z filiali bo'yicha oladi (filiallar reytingi — hammasi).

## Bildirishnomalar (🔔 va telefon push)

1. Bot kodini (`supabase/functions/telegram/index.ts`) yangilab **Deploy** qiling.
2. `notifications.sql` ni SQL Editor'da ishga tushiring (push kalitlari avtomatik yaratiladi). Tekshirish: `select public.push_public_key();`
3. Har bir foydalanuvchi: **Profil → 📱 Telefon bildirishnomalari → Yoqish**. iPhone'da avval Safari → Ulashish → «Bosh ekranga qo'shish», keyin ikonkadan kirib yoqiladi (iOS 16.4+).

Saytdagi 🔔 qo'ng'iroqcha hammada avtomatik ishlaydi: yangi topshiriq, baho, shikoyat, murojaat javobi, menejer xabari, vazifa vaqti eslatmasi.

## Smenali xodimlar

`shift.sql` ni SQL Editor'da ishga tushiring (branch_admin.sql dan keyin) va bot kodini yangilab Deploy qiling.

- Admin panel → Xodimlar → «Ish tartibi» ustunida xodimni **Smenali** qiling (yoki qo'shishda katakchani belgilang).
- Xodim kelgan kuni saytda («Xodimlar» sahifasi) yoki botda **✅ Ishga keldim** ni bosadi — shu kunning to-do ro'yxati yoqiladi. Kelmagan kunlar hisobga olinmaydi.
- Kechikish ishga kelgan vaqtdan hisoblanadi. Admin kelganlikni istalgan kun uchun belgilay/olib tashlay oladi.

## Bosh admin → filial adminlari

`chief.sql` ni SQL Editor'da ishga tushiring (shift.sql dan keyin) va bot kodini yangilab Deploy qiling.

- **Topshiriq:** Admin panel → Topshiriq berish → «Kimga» ro'yxatidagi **Filial adminlari** guruhidan tanlang. Filial admini uni «Topshiriqlar» sahifasining yuqorisida («Bosh admindan topshiriqlar») va botda ko'radi, «Bajarildi» bosadi — bosh adminga xabar keladi.
- **Xabar:** Xabarlar → Xabar yuborish → «🧑‍💼 Barcha filial adminlariga» yoki bitta filial admini. Filial admini uni «Xabarlar → Bosh admindan» bo'limida, 🔔, telefon va Telegram'da oladi; kim o'qiganini ko'rasiz. Botda: `/xabar` → «Filial adminlariga».

## Guruh topshiriqlari

Admin panel → Topshiriq berish → «Kimga» ro'yxatining **Guruhga (bir yo'la)** qismi: hammaga, barcha ustozlarga, barcha xodimlarga, lavozim bo'yicha (Receptionist / Cleaner / Academic support), bosh admin uchun — barcha filial adminlariga. Bosh admin «Qaysi filial» bilan guruhni bitta filialga cheklaydi. Har bir kishi o'z nusxasini bajaradi; ro'yxatda «5 / 8 bajardi» va «Kim bajardi?» ko'rinadi. SQL o'zgarishi yo'q — faqat sayt va bot kodi.
