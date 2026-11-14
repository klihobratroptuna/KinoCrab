/// <reference path="../pb_data/types.d.ts" />
// Коллекция карусели «Сериалы». Имена полей те же, что в трёх существующих каруселях
// (title, year, genre, poster, kinopoiskId, imdbId, kodikId, sourceUrl, checkNote,
// checkDay, day, pos), поэтому поиск по названию и страница /watch читают её так же.
//
// Две новые поля нужны именно для окна ±7 дней:
//   windowDay — день, к которому относится карточка (день поступления в Kodik, день
//     премьеры или день следующей серии). Карусель показывает тайтлы, чей windowDay
//     внутри окна, поэтому запись живёт в карусели до 14 дней, а не один день.
//   player — есть ли у тайтла плеер. Карточку без плеера показываем: она стоит в окне,
//     и раз в сутки проверяем, появился ли плеер (по номеру в Kinopoisk через поиск Kodik).
migrate((app) => {
  // Коллекцию наполняет браузер, поэтому её несложно создать и вручную через API.
  // Проверка нужна, чтобы повторный прогон миграции не падал, если она уже есть.
  // В PocketBase 0.40 поиск по имени не возвращает null, а бросает ErrRecordNotFound
  // («sql: no rows in result set»), и на чистой базе падает весь прогон миграций: замер
  // 2026-11-07 10:33 — контейнер стартует, ошибается на этом файле и выходит, ни одна
  // коллекция не создаётся (PocketBase применяет миграции одной транзакцией и откатывает).
  let existing = null;

  try {
    existing = app.findCollectionByNameOrId("series_carousel");
  } catch {
    existing = null;
  }
  // Возвращать модель здесь нельзя: исполнитель миграций считает любое значение ошибкой
  // («could not convert {...} to error») и PocketBase падает на старте. Проверили 2026-11-03:
  // коллекцию создали через API, поэтому этот файл не был записан как выполненный и
  // повторялся при каждом запуске. Ничего не возвращаем.
  if (existing) return null;

  const collection = new Collection({
    "createRule": "",
    "deleteRule": "",
    "fields": [
      {
        "autogeneratePattern": "[a-z0-9]{15}",
        "help": "",
        "hidden": false,
        "id": "text3208210256",
        "max": 15,
        "min": 15,
        "name": "id",
        "pattern": "^[a-z0-9]+$",
        "presentable": false,
        "primaryKey": true,
        "required": true,
        "system": true,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "День прохода карусели (YYYY-MM-DD по Москве). Показываем записи последнего прохода.",
        "hidden": false,
        "id": "text1186403937",
        "max": 0,
        "min": 0,
        "name": "day",
        "pattern": "",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "help": "Позиция карточки в карусели, от 1. Порядок — по дню окна, самые свежие первыми.",
        "hidden": false,
        "id": "number2161764012",
        "max": null,
        "min": null,
        "name": "pos",
        "onlyInt": false,
        "presentable": false,
        "required": false,
        "system": false,
        "type": "number"
      },
      {
        "autogeneratePattern": "",
        "help": "Имя для сопоставления записей (без регистра и пунктуации) — тот же ключ, что в nameIndex.",
        "hidden": false,
        "id": "text1793500001",
        "max": 0,
        "min": 0,
        "name": "nameKey",
        "pattern": "",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "День окна (YYYY-MM-DD): поступление в Kodik, премьера или ближайшая серия. За пределами окна карточка из карусели уходит.",
        "hidden": false,
        "id": "text1793500002",
        "max": 0,
        "min": 0,
        "name": "windowDay",
        "pattern": "",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "",
        "hidden": false,
        "id": "text724990059",
        "max": 0,
        "min": 0,
        "name": "title",
        "pattern": "",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "",
        "hidden": false,
        "id": "text1061607967",
        "max": 0,
        "min": 0,
        "name": "year",
        "pattern": "",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "Первый жанр из строки источника.",
        "hidden": false,
        "id": "text1793500003",
        "max": 0,
        "min": 0,
        "name": "genre",
        "pattern": "",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "Оценка источника (MyDramaList у Kodik). Пусто, когда оценки нет.",
        "hidden": false,
        "id": "text1793500004",
        "max": 0,
        "min": 0,
        "name": "rating",
        "pattern": "",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "Строка серий из карточки источника, например «1-12 Серия из 21».",
        "hidden": false,
        "id": "text3100301471",
        "max": 0,
        "min": 0,
        "name": "episode",
        "pattern": "",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "exceptDomains": [],
        "help": "",
        "hidden": false,
        "id": "url762383602",
        "name": "poster",
        "onlyDomains": [],
        "presentable": false,
        "required": false,
        "system": false,
        "type": "url"
      },
      {
        "autogeneratePattern": "",
        "help": "Номер фильма в Kinopoisk. Пусто, когда источника по названию не сопоставили.",
        "hidden": false,
        "id": "text1793500005",
        "max": 0,
        "min": 0,
        "name": "kinopoiskId",
        "pattern": "",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "",
        "hidden": false,
        "id": "text1793500006",
        "max": 0,
        "min": 0,
        "name": "imdbId",
        "pattern": "",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "Идентификатор записи Kodik (вид serial-...), по которому страница /watch находит плеер.",
        "hidden": false,
        "id": "text2342255404",
        "max": 0,
        "min": 0,
        "name": "kodikId",
        "pattern": "",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "help": "Есть ли у тайтла плеер. Карточку без плеера показываем и раз в сутки перепроверяем.",
        "hidden": false,
        "id": "bool1793500007",
        "name": "player",
        "required": false,
        "system": false,
        "type": "bool"
      },
      {
        "autogeneratePattern": "",
        "help": "Откуда взята карточка: kodik (строка списка) или calendar (календарь премьер без записи Kodik).",
        "hidden": false,
        "id": "text1793500008",
        "max": 0,
        "min": 0,
        "name": "via",
        "pattern": "",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "",
        "hidden": false,
        "id": "text1793500009",
        "max": 0,
        "min": 0,
        "name": "sourceUrl",
        "pattern": "",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "Результат проверки плеера по номеру в Kinopoisk. Пустое поле не значит «не нашли»: запрос мог не ответить.",
        "hidden": false,
        "id": "text1793500601",
        "max": 0,
        "min": 0,
        "name": "checkNote",
        "pattern": "",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "День последней проверки плеера.",
        "hidden": false,
        "id": "text1793500602",
        "max": 0,
        "min": 0,
        "name": "checkDay",
        "pattern": "",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "text"
      }
    ],
    "indexes": [
      "CREATE INDEX IF NOT EXISTS series_carousel_day_idx ON series_carousel (day)",
      "CREATE INDEX IF NOT EXISTS series_carousel_name_key_idx ON series_carousel (nameKey)",
      "CREATE INDEX IF NOT EXISTS series_carousel_window_day_idx ON series_carousel (windowDay)"
    ],
    "listRule": "",
    "name": "series_carousel",
    "system": false,
    "type": "base",
    "updateRule": "",
    "viewRule": ""
  });

  return app.save(collection);
}, (app) => {
  // Тот же характер поиска на чистой базе: без проверки откат падает с той же ошибкой.
  let collection = null;

  try {
    collection = app.findCollectionByNameOrId("series_carousel");
  } catch {
    return null;
  }

  return app.delete(collection);
})
