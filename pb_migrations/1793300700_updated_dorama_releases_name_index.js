/// <reference path="../pb_data/types.d.ts" />
// nameKey и индекс по имени в dorama_releases (pbc_3622903276) — запасной путь поиска.
//
// Раньше индексы были только на doramatvId и date. Поиск по имени строился фильтром
// `title~"..."`, то есть LIKE '%значение%', а индекс для LIKE не работает — поэтому
// добавлено поле nameKey (имя в виде сравнения: без регистра и пунктуации) и индекс по
// нему. Запрос с точным равенством `nameKey="..."` попадает в этот индекс; код
// $lib/shared/nameIndex.js сначала спрашивает по nameKey, и только при пустом ответе
// использует прежний LIKE по title — так старые записи без ключа остаются рабочими.
//
// Три момента, проверенные живыми прогонами (2026-10-31):
//   1. PATCH с полями и индексами нужно посылать полными списками: PATCH только с одним
//      новым полем ответил 400 «no such column: doramatvId», потому что при сохранении
//      коллекции PocketBase пересоздаёт все индексы по новому списку полей.
//   2. help короче 300 байт — иначе миграция падает (правило max=300 считается в байтах).
//   3. Индекс — строкой SQL и через push: в runtime миграций PocketBase 0.40 нет модели
//      Index (migrate с new Index(...) упал с ReferenceError: Index is not defined), а
//      collection.indexes — обычный список, у которого нет метода add (проверено прогоном
//      на чистой базе: «Object has no member 'add'»). Строки индексов PocketBase
//      принимает — так же устроены индексы в миграции создания dorama_releases. Прогон на
//      чистой базе (2026-10-31): поле и индекс появились, ошибок в журнале нет.
//
// Существующие 157 записей ключа не имели: их заполнил скрапер (шаг --fill-name-key,
// 2026-10-31), и он пишет nameKey для каждой новой дорамы.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3622903276")

  if (!collection.fields.getByName("nameKey")) {
    collection.fields.addAt(collection.fields.length, new Field({
      "help": "Нормализованное название для поиска по имени (без регистра и пунктуации): резервный путь, когда id источника пуст.",
      "hidden": false,
      "id": "text1793300701",
      "name": "nameKey",
      "presentable": false,
      "required": false,
      "system": false,
      "type": "text"
    }))
  }

  if (!collection.indexes.some((index) => String(index).includes("dorama_releases_name_key_idx"))) {
    collection.indexes.push("CREATE INDEX IF NOT EXISTS dorama_releases_name_key_idx ON dorama_releases (nameKey)")
  }

  app.save(collection)

  return null
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3622903276")

  if (collection.fields.some((field) => field.id === "text1793300701")) {
    collection.fields.removeById("text1793300701")
  }

  app.run("DROP INDEX IF EXISTS dorama_releases_name_key_idx")

  app.save(collection)

  return null
})
