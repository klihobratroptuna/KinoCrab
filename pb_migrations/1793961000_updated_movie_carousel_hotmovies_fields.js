/// <reference path="../pb_data/types.d.ts" />
// Поля ленты фильмов под правило-гейт («в ленте только тайтлы, найденные нашими плеерами») —
// коллекция movie_carousel (pbc_1653049656). Коллекцию не переименовываем: её читают интерфейс
// карусели и страница /watch, новое имя заставило бы менять модуль и адрес карточки.

// Что добавляется и почему (замеры 2026-11-06 через прокси http://localhost:3000):
//
// quality, qualityTier, qualitySource, resolution — плашка качества берётся из поля `quality`
// того же ответа Kodik, который делает гейт, поэтому отдельного запроса к API нет. Строка
// «BDRip» без цифр разрешением не является: разрешение видно в `link` (`.../720p`), поэтому
// resolution — отдельное поле, иначе тир считается неверно. Замер значений дня: BDRip 720p,
// WEB-DLRip 720p, HDTVRip 720p, HDRip, SATRip, BDRip; camrip=false во всех строках.
//
// playerVia — чей плеер нашёл тайтл. Alloha отвечает только по номеру и для трёх фильмов
// подборки дал «not movie», то есть работает не всегда; поля качества у него нет, и интерфейс
// должен знать, что плашки может не быть.
//
// playerAddedAt — дата появления рипа (created_at строки Kodik). Ленты «последних поступлений»
// у Kodik нет: search требует хотя бы один поисковый параметр, sort игнорируется, поэтому лента
// собирается из известных имён пула, а её порядок — дата, когда рип появился.
//
// qualityChangedAt — день, когда тир рипа реально улучшился. Служебное `updated` для этого не
// подходит: оно меняется при любом сохранении, включая пустой ответ источника, и поднимало бы
// карточку без изменения качества.
//
// ratingCount — голоса. Пороги качества: 6.0 и 50 голосов, внутри окна премьеры 10
// (решение 2026-11-06). Без поля голоса неотличимы от оценки, и 4.5 из трёх голосов прошла
// бы ленту.
//
// nameKey — нормализованное имя. Поиск Kodik работает по словам, а не по точному имени (замер
// 2026-11-06: по запросу «Тёмный рыцарь» в выдаче «Рыцарь теней» и «Шанхайский рыцарь»),
// поэтому сравнение идёт по ключу, и ключ храним, чтобы не пересчитывать его при каждом
// посещении страницы. Индекс по имени — тот же путь, что в дорамах (миграция 1793300700):
// запрос по ключу попадает в индекс, LIKE по title остаётся запасным путём.
//
// Правила, которые надо помнить: PocketBase принимает только поля схемы, неизвестное поле молча
// отбрасывается (так терялись checkNote и checkDay — миграция 1793300600). Help короче 300 байт,
// иначе миграция падает. Миграция устойчива к повторному запуску: поле добавляем только если его
// нет, индекс — только если его нет в списке коллекции.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1653049656")

  const fields = [
    {
      "autogeneratePattern": "",
      "help": "Чей плеер нашёл тайтл: kodik или alloha. Пустое поле — карточки в ленте нет.",
      "hidden": false,
      "id": "text1793961001",
      "max": 0,
      "min": 0,
      "name": "playerVia",
      "pattern": "",
      "presentable": false,
      "required": false,
      "system": false,
      "type": "text"
    },
    {
      "autogeneratePattern": "",
      "help": "Строка качества из ответа Kodik (BDRip 720p). У Alloha поля качества нет.",
      "hidden": false,
      "id": "text1793961002",
      "max": 0,
      "min": 0,
      "name": "quality",
      "pattern": "",
      "presentable": false,
      "required": false,
      "system": false,
      "type": "text"
    },
    {
      "help": "Тир рипа: 1 — BDRip/WEB-DL 1080p и выше, 2 — WEB-DL/BDRip 720p, 3 — HDTVRip/HDRip, 4 — SD, 5 — CAMRIP (в ленту не пускаем).",
      "hidden": false,
      "id": "number1793961003",
      "max": null,
      "min": null,
      "name": "qualityTier",
      "onlyInt": true,
      "presentable": false,
      "required": false,
      "system": false,
      "type": "number"
    },
    {
      "autogeneratePattern": "",
      "help": "Источник рипа из строки quality: bluray, webdl, webrip, hdtv, hd, sat, cam. Тир считается из него и разрешения.",
      "hidden": false,
      "id": "text1793961004",
      "max": 0,
      "min": 0,
      "name": "qualitySource",
      "pattern": "",
      "presentable": false,
      "required": false,
      "system": false,
      "type": "text"
    },
    {
      "autogeneratePattern": "",
      "help": "Разрешение из ссылки, не из названия: quality бывает без цифр («BDRip»).",
      "hidden": false,
      "id": "text1793961005",
      "max": 0,
      "min": 0,
      "name": "resolution",
      "pattern": "",
      "presentable": false,
      "required": false,
      "system": false,
      "type": "text"
    },
    {
      "autogeneratePattern": "",
      "help": "Дата появления рипа (created_at строки Kodik): свежесть внутри качества.",
      "hidden": false,
      "id": "text1793961006",
      "max": 0,
      "min": 0,
      "name": "playerAddedAt",
      "pattern": "",
      "presentable": false,
      "required": false,
      "system": false,
      "type": "text"
    },
    {
      "autogeneratePattern": "",
      "help": "День прохода, когда тир рипа реально улучшился. При том же качестве не пишется.",
      "hidden": false,
      "id": "text1793961007",
      "max": 0,
      "min": 0,
      "name": "qualityChangedAt",
      "pattern": "",
      "presentable": false,
      "required": false,
      "system": false,
      "type": "text"
    },
    {
      "help": "Голоса источника оценки. Порог: 50, внутри окна премьеры 10.",
      "hidden": false,
      "id": "number1793961008",
      "max": null,
      "min": null,
      "name": "ratingCount",
      "onlyInt": true,
      "presentable": false,
      "required": false,
      "system": false,
      "type": "number"
    },
    {
      "autogeneratePattern": "",
      "help": "Нормализованное имя для чтения ленты без пересчёта: поиск Kodik работает по словам, поэтому сравнение идёт по ключу.",
      "hidden": false,
      "id": "text1793961009",
      "max": 0,
      "min": 0,
      "name": "nameKey",
      "pattern": "",
      "presentable": false,
      "required": false,
      "system": false,
      "type": "text"
    }
  ]

  for (const definition of fields) {
    if (collection.fields.getByName(definition.name)) continue

    collection.fields.addAt(collection.fields.length, new Field(definition))
  }

  const indexes = [
    "CREATE INDEX IF NOT EXISTS movie_carousel_name_key_idx ON movie_carousel (nameKey)",
    "CREATE INDEX IF NOT EXISTS movie_carousel_quality_idx ON movie_carousel (qualityTier, playerAddedAt)"
  ]

  for (const index of indexes) {
    if (collection.indexes.some((existing) => String(existing) === index)) continue

    collection.indexes.push(index)
  }

  app.save(collection)

  return null
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1653049656")

  const ids = [
    "text1793961001", "text1793961002", "number1793961003", "text1793961004", "text1793961005",
    "text1793961006", "text1793961007", "number1793961008", "text1793961009"
  ]

  for (const id of ids) {
    if (collection.fields.some((field) => field.id === id)) collection.fields.removeById(id)
  }

  app.run("DROP INDEX IF EXISTS movie_carousel_name_key_idx")
  app.run("DROP INDEX IF EXISTS movie_carousel_quality_idx")

  app.save(collection)

  return null
})
