/// <reference path="../pb_data/types.d.ts" />
// nameKey и индекс по имени в anime_releases (pbc_3132965740) — запасной путь поиска,
// тот же, что уже сделан для дорам (миграция 1793300700).
//
// Индексы в коллекции были только на slug, shikimoriId и date. Страница /watch для аниме
// ищет запись по `shikimoriId="..."` — по id карточки AnimeGO. Если тайтла в календаре
// нет, поиск по имени фильтром `title~"..."` работает как LIKE, а индекс для LIKE не
// работает. Поле nameKey (имя в виде сравнения: без регистра и пунктуации) и индекс по нему
// дают точный запрос `nameKey="..."`, который попадает в индекс. Код
// $lib/shared/nameIndex.js спрашивает сначала по nameKey, LIKE по title остаётся запасным
// путём для записей без ключа.
//
// Правило нормализации то же, что в скрапере дорам и в $lib/shared/nameIndex.js, иначе
// ключ не совпадёт. Живая проверка (2026-10-31): индексов на nameKey в anime_releases нет,
// поле отсутствует — миграция создаёт их на чистой базе, ошибок в журнале нет.
//
// 145 существующих записей ключа не имели: их заполняет шаг --fill-name-key скрапера
// аниме (scripts/scrape-anime.mjs), и он пишет nameKey для каждой новой записи.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3132965740")

  if (!collection.fields.getByName("nameKey")) {
    collection.fields.addAt(collection.fields.length, new Field({
      "help": "Нормализованное название для поиска по имени (без регистра и пунктуации): резервный путь, когда id Shikimori не найден.",
      "hidden": false,
      "id": "text1793440301",
      "name": "nameKey",
      "presentable": false,
      "required": false,
      "system": false,
      "type": "text"
    }))
  }

  if (!collection.indexes.some((index) => String(index).includes("anime_releases_name_key_idx"))) {
    collection.indexes.push("CREATE INDEX IF NOT EXISTS anime_releases_name_key_idx ON anime_releases (nameKey)")
  }

  app.save(collection)

  return null
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3132965740")

  if (collection.fields.some((field) => field.id === "text1793440301")) {
    collection.fields.removeById("text1793440301")
  }

  app.run("DROP INDEX IF EXISTS anime_releases_name_key_idx")

  app.save(collection)

  return null
})
