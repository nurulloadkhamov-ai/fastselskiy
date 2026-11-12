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
