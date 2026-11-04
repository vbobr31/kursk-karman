# Умный карман курского школьника

Чат-бот для тура IV турнира «CG/3D/VR/AR/AI»: помогает школьникам Курской области накопить на культурное событие.

- **Telegram-бот:** https://t.me/kurskie_meropriyatiya_bot
- **Сайт / Mini App:** https://vbobr31.github.io/kursk-karman/

## Как устроено
| Часть | Где | Что делает |
|---|---|---|
| `worker/` | Cloudflare Workers | Telegram-webhook, мастер цели, копилка (KV), викторина, ИИ (Workers AI, Llama 3.3 70B), API `/api/chat` для сайта |
| `docs/` | GitHub Pages | Сайт и Telegram Mini App: чат с ИИ, афиша, калькулятор цели, копилка, советы, викторина |
| `docs/data/events.json` | — | **Единый источник данных** для бота и сайта: афиша, цены, советы, вопросы викторины |
| `.github/workflows/remind.yml` | GitHub Actions | Воскресные напоминания «пора отложить» |

## Как обновить афишу
Отредактируйте `docs/data/events.json` и сделайте commit — сайт обновится через минуту, бот подхватит данные в течение 5 минут.

## Деплой бота
```bash
cd worker && npm install
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npx wrangler deploy
```
