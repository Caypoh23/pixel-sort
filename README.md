# Pixel Sort — тест рынка

Браузерная демо-версия игры, ролики для соцсетей и автоматика теста: публикации по расписанию и ежедневный отчёт.

- **Демо:** https://caypoh23.github.io/pixel-sort/ (GitHub Pages, папка `docs/`)
- **Свежий отчёт:** [reports/latest.md](reports/latest.md), обновляется каждое утро в 08:17 по Ташкенту
- **Календарь публикаций:** [content/schedule.json](content/schedule.json)

## Что где лежит

| Путь | Что это |
|---|---|
| `docs/` | Сайт: игра (`index.html`), настройки (`config.js`), ролики (`clips/`), иконки, превью для соцсетей, политика конфиденциальности |
| `content/schedule.json` | 14 дней публикаций: ролик и подписи для Instagram, YouTube, Threads и X |
| `content/posted.json` | Что уже поставлено в очередь Buffer (пишет бот) |
| `scripts/autopost.py` | Ставит ролик дня в очередь Buffer на все подключённые каналы |
| `scripts/report.py` | Забирает воронку из PostHog и пишет отчёт в `reports/` |
| `.github/workflows/` | Расписание: автопостинг каждые 6 часов, отчёт каждое утро |
| `tools/engine/` | Исходники игры, генератор уровней, сборка сайта и рендер роликов |

## Включение (один раз)

1. **GitHub Pages:** Settings → Pages → Deploy from a branch → `main` и папка `/docs`.
2. **Аналитика:** в `docs/config.js` вписать `posthogKey` (ключ проекта PostHog, начинается с `phc_`) и, когда появится рекламный кабинет, `metaPixelId`. Туда же — ссылки на профили в `links`.
3. **Секреты репозитория** (Settings → Secrets and variables → Actions → New repository secret):
   - `BUFFER_API_KEY` — ключ API Buffer (publish.buffer.com/settings/api);
   - `POSTHOG_PERSONAL_API_KEY` — личный ключ PostHog с правом чтения запросов (Query read). Проект PostHog — 658447 (US), он уже прописан в workflow.
   Для облака PostHog в ЕС добавьте переменную `POSTHOG_API_HOST` = `https://eu.posthog.com` (вкладка Variables).
4. **Старт публикаций:** в `content/schedule.json` поставить `start_date` (например `"2026-10-18"`) и `site_url` (адрес демо со слешем на конце). Время выхода — `post_time_utc`, по умолчанию 22:30 UTC (18:30 в Нью-Йорке).

Проверить без публикации: Actions → Autopost clips → Run workflow. Скрипт напишет, что поставил в очередь или чего не хватает.

## Ссылки с метками

Органика размечается сама (`utm_source=instagram|threads|x|youtube`). Для рекламы используйте:

```
https://caypoh23.github.io/pixel-sort/?utm_source=meta&utm_medium=paid&utm_campaign=test1&utm_content=AD1
```

`utm_content` — номер ролика (AD1, AD2, AD3). По нему отчёт делит игроков по креативам.

## Новые ролики и уровни

```
cd tools/engine
npm install
pip install playwright numpy pyyaml
python3 gen_levels.py        # уровни из art.py и art_new.py
python3 build.py --video     # сборка страницы для рендера
python3 render.py A D        # ролики по id из CLIPS в render.py, результат в out/
python3 build_site.py ../..  # пересобрать docs/index.html
```
