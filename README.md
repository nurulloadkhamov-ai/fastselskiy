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
