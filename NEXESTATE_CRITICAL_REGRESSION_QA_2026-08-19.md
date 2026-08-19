# NexEstate Presentation Studio — Critical Regression QA

Дата проверки: 2026-08-19

Ветка: `codex/nexestate-ui-redesign-v2`

Исходный SHA: `e6c6fba40941bbe2e3025c317a9aa1a79977d50e`

Финальный browser-run: `1787140155461-17012`

Машиночитаемый отчёт: `qa/results/critical-regression-20260819-final.json`

Итог browser-run: **136 PASS / 0 FAIL / 0 NOT TESTED**.

## Первопричины и исправления

| Дефект | Первая подтверждённая причина | Исправление |
|---|---|---|
| Кнопки Chromium и зависающий tooltip | Элементы нижней панели и служебные слои имели пересекающуюся геометрию; отдельные tooltip/progress-слои могли оставаться активными, а повторная инициализация обработчиков создавала нестабильный hit-test. | Обработчики сделаны идемпотентными, служебным слоям задан безопасный pointer-event lifecycle, tooltip закрывается по всем требуемым событиям, геометрия панели исправлена и проверена через `elementFromPoint` и реальные клики. |
| Сброс режима после планировки | Асинхронный media-flow смешивал обновление plan asset с повторным применением устаревшего snapshot настроек; служебная связь страницы попадала в текст характеристики. | Размещение хранится как отдельная metadata-связь; media-операция изменяет только media/placement; инварианты режима, темы, шрифта, страницы и scroll проверяются до/после; служебный текст исключён из пользовательских характеристик. |
| Нельзя управлять размещением планировки | У plan asset отсутствовало самостоятельное каноническое placement-состояние. | Добавлены варианты обложка / существующая страница / отдельная страница, защита занятых слотов, отсутствие дублей, Undo/Redo и persistence/export одной цепочкой. |
| Неполная синяя focus-связь | Одновременно работали несколько исторических focus-слоёв, а stale target/connector не очищался при blur и смене контекста. | Введён единый lifecycle одной связи: source + target + connector, немедленная очистка при blur/click-away/закрытии/смене вкладки, страницы, режима и проекта, пересчёт при scroll/resize. |
| «Назначение» отсутствовало на обложке | Каноническое поле не было подключено ко всем активным renderer/export путям. | Поле связано с обоими renderer, persistence, шаблонами, backup, PDF и PNG; пустое значение скрывает блок, длинное ограничивается безопасной областью. |
| Метро теряло станции и способ движения | Старое состояние было скалярным и parser использовал одно совпадение. | Добавлена каноническая коллекция станций, разбор нескольких форм времени и режима движения, нейтральный fallback и компактный renderer без выдуманных автомобильных данных. |
| Неверный skyline и пересечение логотипа | Renderer использовал самостоятельную отрисовку зданий и не резервировал независимую safe-area. | Подготовлен один прозрачный PNG из единственного референса; все render/export пути ждут его загрузку, используют одну геометрию и отдельную safe-area; последующие страницы сохраняют компактный `NEX`; режим без логотипов обратим. |
| Огромный длинный заголовок | Размер определялся без измерения полной безопасной области и без независимого резерва логотипа. | Введён measured fit с ограничением строк, минимальным размером, line-height и renderer-only ellipsis при сохранении полного канонического текста. |
| Нижняя панель перекрывала элементы | Grid применялся не к паре кнопок, а к обёртке, native select расширялся за формальную ширину, а соседние группы перехватывали hit-test. | Исправлены flex/grid ownership и intrinsic widths; на узких экранах используется горизонтальный scroll; высота 64 px, все элементы физически доступны и не меняют размеры по состояниям. |
| Неверные подписи Studio/Hub | Подпись Studio находилась в шапке и была слишком мала; Hub содержал старую строку. | Подпись перенесена под карточки и увеличена; Hub показывает точные строки `NexEstate by Эдик Великий` / `Единая рабочая среда`. |
| Нестабильный переход «К презентациям» | Переход зависел от stale overlay и относительного контекста без единого history lifecycle. | Добавлен base-aware маршрут с очисткой слоёв, сохранением состояния и поддержкой Back/Forward, GitHub Pages и offline PWA. |
| Скрытые настройки шрифтов | Последующие UI-слои скрывали/перемещали существующий реальный контрол. | Реальный раздел возвращён во вкладку «Данные»; значения разделены по режимам и проходят через project/template/backup/export. |
| Ложная ошибка локального хранилища | Blob дублировались в settings/snapshot/backup, а live-record менялся до подтверждения IDB transaction. | Бинарные данные канонизированы в IndexedDB, settings стали metadata-only, save/backup транзакции атомарны, backup failure не отменяет уже сохранённый проект, ошибки quota/transaction диагностируются точно. |
| Риск деградации PDF-фото | Старый pipeline выделял несколько полноразмерных canvas и допускал неопределённые кандидаты. | Добавлены pixel budgets, адаптивный render, освобождение canvas, сохранение исходных размеров Blob, региональная фильтрация и детерминированные 8/8 fixtures. |

## Браузерная матрица

| среда | сценарий | ожидаемо | фактически | PASS/FAIL | доказательство/ошибка |
|---|---|---|---|---|---|
| Chrome ordinary, 1440×900 | Persistent-profile smoke | Повторный запуск без старого SW/данных не ломает UI | 20 проверок, актуальный cache `v45`, ошибок нет | PASS | JSON: environment `Chrome ordinary persistent desktop` |
| Chrome fresh, 1440×900 | Полный функциональный поток | Все критические сценарии выполняются физическими действиями | 44 проверки прошли | PASS | JSON: environment `Chrome fresh desktop` |
| Chrome narrow, 1024×720 | Узкая desktop-компоновка | Панель 64 px, функции доступны, перекрытий нет | 19 проверок, hit-test и клики прошли | PASS | JSON: environment `Chrome narrow desktop` |
| Edge InPrivate, 1440×900 | Свежий Chromium-контекст | Кнопки и layout работают без перехвата | 19 проверок прошли | PASS | JSON: environment `Edge InPrivate desktop` |
| Firefox Private, 1440×900 | Независимый движок | Ключевые действия и hit-test работают | 15 Selenium/WebDriver проверок прошли | PASS | JSON: environment `Firefox private desktop` |
| Chrome Pixel 7 touch, 412×839 | Touch/mobile | Все элементы достижимы tap, панель не перекрывает preview | 19 проверок, touch hit-test прошёл | PASS | JSON: environment `Chrome Pixel 7 touch` |

## Критерии приёмки

| среда | сценарий | ожидаемо | фактически | PASS/FAIL | доказательство/ошибка |
|---|---|---|---|---|---|
| Все 6 сред | Свежая загрузка и bind кнопок | V80/V80D/V81/V82 загружены, duplicate ID и runtime error отсутствуют | Инициализация завершена, список duplicate ID пуст | PASS | 6× `Свежая загрузка приложения` |
| Все 6 сред | Главные действия Hub | New/PDF/text/photo/project launchers получают физический click/tap | Hit-test, реальные clicks и filechooser прошли без force | PASS | 36 hit-test/launcher checks + реальные workflows |
| Chrome/Edge/Firefox/mobile | Tooltip lifecycle | Исчезает по leave, blur, Escape и смене экрана, не ловит pointer | Tooltip скрыт, соседние клики проходят | PASS | 5× `Tooltip не перехватывает соседние клики` |
| Chrome fresh | Планировка не сбрасывает состояние | Режим, тема, шрифт, страница и scroll неизменны | Все инварианты равны значениям до импорта | PASS | `Загрузка планировки не сбрасывает режим/тему/шрифт/страницу/scroll` |
| Chrome fresh | Размещение планировки | Обложка, существующая и отдельная страница без потери фото/дублей | Все три назначения, persistence и renderer metadata корректны | PASS | 2 placement checks + reload/export checks |
| Chrome fresh | Служебное значение страницы | `-- СТРАНИЦА N` не попадает в state/preview | Совпадений нет | PASS | `Служебное «-- СТРАНИЦА N» отсутствует в state/preview` |
| Chrome fresh | Undo/Redo plan placement | Размещение полностью обратимо | State и UI вернулись в ожидаемые позиции | PASS | `Undo/Redo размещения планировки` |
| Chrome fresh | Focus field → preview | Ровно две рамки и одна линия во время focus; после blur всё исчезает | Счётчики 1/1/1 → 0/0/0, включая contact first focus | PASS | `Focus-связь…` + `Контакт брокера…` |
| Chrome fresh | Назначение | UI → canonical state → by/single → save/export | Значение видно в обоих renderer и сохраняется | PASS | `Назначение: UI → state → оба renderer` |
| Chrome fresh | Метро | Две станции и пешее время; автомобиль не выдуман | Обе станции сохранены, walk-иконки/минуты верны, car отсутствует | PASS | `Метро: две станции…` + parser fixtures 19/19 |
| Chrome fresh | Точный logo asset | Один прозрачный asset, отдельная safe-area, export ждёт decode | PNG 640×505 ARGB, SHA-256 `A60736845F126492B271BE6B5F07C57F0584B25B3370BED847CBDA7C587A84B7` | PASS | `Точный прозрачный logo-asset…`; physical PNG export |
| Chrome fresh | Title fit | 4 длины × 2 режима, без пересечений, полный canonical текст | Все 8 вариантов помещены; extreme использует renderer ellipsis | PASS | `Fit заголовка…` |
| Desktop/narrow/mobile | Нижняя панель | 64 px, без overlap, все функции доступны | Высота 64 px, overlap 0, center hit-test каждого видимого контрола корректен | PASS | 6 panel checks + physical mode/no-logo actions |
| Chrome fresh | Studio/Hub подписи | Подпись Studio внизу и крупнее; Hub имеет точные строки | DOM и визуальная область соответствуют требованиям | PASS | fresh-load/hub assertions в JSON |
| Все 6 сред + PWA | «К презентациям» / «К приложениям» | Base-aware переходы, Back/Forward и offline | Экран проектов и Hub открываются без потери состояния | PASS | 7 route checks + `PWA: service worker и offline reload` |
| Все 6 сред | Настройки шрифтов | Видимы, интерактивны и независимы по режимам | Контрол доступен во всех средах; by/single значения независимы | PASS | 6 font checks + `Шрифты независимы…` |
| Chrome fresh | Project/template/backup persistence | Reload/reopen не теряет режим, назначение, plan и fonts | Snapshot и восстановленные значения совпали | PASS | reload, template, backup checks |
| Chrome fresh | IndexedDB/localStorage | Бинарные данные в IDB, localStorage только metadata | Blob найдены в IDB; больших data/base64 payload в localStorage нет | PASS | `IndexedDB хранит бинарные данные…` |
| Chrome fresh | PDF/photo extraction | Физическая загрузка, перенос и исходное качество | Filechooser, processing settlement и Media transfer прошли; фильтр fixtures 8/8 | PASS | PDF/photo/import checks + classifier fixtures |
| Chrome fresh | PDF/PNG и каталог | Оба режима экспортируются; каталог скачивается | Сигнатуры `%PDF-` и PNG валидны, catalog PDF создан | PASS | export/catalog checks |
| Chrome fresh | «Без логотипов» | Скрывает только app-branding и обратимо восстанавливается | Hidden tokens пусты; branded first=`NEX, ESTATE, BUILDINGS`, later=`NEX` | PASS | no-logo reload/export assertions |
| Все среды | Console/pageerror/unhandled rejection | Ошибок после последней правки нет | Массивы console error/pageerror/unhandled/requestfailed пусты | PASS | 5 explicit error checks + final run summary |

## Статические проверки

- `git diff --check`: PASS; только уведомления Git о будущем LF→CRLF, ошибок whitespace нет.
- `node --check qa/e2e-critical-regression-20260819.js`: PASS.
- `node --check service-worker.js`: PASS.
- Компиляция inline script через `new Function`: 66/66 PASS.
- Conflict markers: 0.
- Абсолютные локальные пути/debug URL в изменённых production-файлах: 0.
- Impeccable detector запущен ровно один раз после финальной UI-правки. Он вернул 20 warning/advisory по существующему legacy-коду (системные/пользовательские font options, исторические width transitions, динамические `<img>` без статического `src`, рабочая grid-поверхность и существующий glow); новых блокирующих ошибок не выявлено. Эти предупреждения не исправлялись, поскольку задача запрещает общий редизайн, а динамический `src` назначается runtime.

## Изменённые файлы

- `apps/presentation/index.html`
- `apps/presentation/assets/nexestate-logo-reference-clean.png`
- `index.html`
- `service-worker.js`
- `qa/e2e-critical-regression-20260819.js`
- `qa/results/critical-regression-20260819-final.json`
- `qa/tools/prepare-nexestate-logo-reference.py`
- `NEXESTATE_CRITICAL_REGRESSION_QA_2026-08-19.md`

## NOT TESTED и ограничения

- **NOT TESTED в обязательной матрице: отсутствуют.** Edge/InPrivate и Firefox/Private были доступны и проверены.
- Нативный системный диалог установки PWA не является частью обязательных критериев и не автоматизировался; service worker, cache, контролируемая страница и offline reload проверены.
- В предоставленном `04_EXACT_LOGO_REFERENCE.png` нижняя правая часть закрыта значком сканирования. Значок и фон удалены прозрачностью; скрытая геометрия **не дорисовывалась**. Поэтому пиксельная идентичность закрытого участка не заявляется. Для неё нужен чистый исходный логотип без значка.
- Merge в `main`, push и Pull Request не выполнялись.
