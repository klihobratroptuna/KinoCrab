/// <reference path="../pb_data/types.d.ts" />
// Проверено на живом запуске: PocketBase считает help в байтах UTF-8 (правило max=300),
// поэтому help на 201 символе кириллицей — это 353 байта, и миграция упала с ошибкой
// «fields: (11: (help: the length must be between 1 and 300.))». Здесь все help короче
// 300 байт, а позиция поля берётся по фактической длине списка.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2449271769")

  const add = (name, id, help) => {
    if (collection.fields.getByName(name)) return

    collection.fields.addAt(collection.fields.length, new Field({
      "help": help,
      "hidden": false,
      "id": id,
      "name": name,
      "required": false,
      "system": false,
      "type": "text"
    }))
  }

  add("kinopoiskId", "text1793300401", "Номер фильма в Kinopoisk по названию карточки; нужен /watch для Alloha и Collaps. Пишет суточный проход.")
  add("checkNote", "text1793300402", "Что дали проверки по названию (Kodik, Kinopoisk). Пустое поле не значит «не нашли»: запрос мог не ответить.")
  add("checkDay", "text1793300403", "День последней проверки тайтла.")

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2449271769")

  for (const id of ["text1793300401", "text1793300402", "text1793300403"]) {
    if (collection.fields.getById(id)) collection.fields.removeById(id)
  }

  return app.save(collection)
})
