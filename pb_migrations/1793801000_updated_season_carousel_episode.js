/// <reference path="../pb_data/types.d.ts" />
// Поле episode для season_carousel (карточка «Аниме»). Его не было: строку серии в базе
// держат только дорамы и сериалы, и код карусели аниме писал episode, но PocketBase
// молча отбрасывал значение — поля в коллекции нет. Проверено 2026-11-05: после
// пересборки дня по онгоингу animevost имена и постеры пришли, а episode остался пустым
// у всех 20 записей, хотя разбор страницы даёт номер серии.
//
// Текстовое поле, как у дорам: значение — строка вида «Серия 5 из 12+», то есть номер
// выхода русской озвучки по заголовку карточки animevost. Числовое поле не передаёт
// «12+» и не различает «серии нет».
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_4285378504")

  if (collection.fields.getByName("episode")) return null

  const episode = new Field({
    "help": "Строка серии: номер выхода русской озвучки по заголовку карточки animevost, иначе номер строки Kodik. Пустое — серии нет.",
    "hidden": false,
    "id": "text1793801001",
    "name": "episode",
    "required": false,
    "system": false,
    "type": "text"
  })

  collection.fields.addAt(collection.fields.length, episode)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_4285378504")

  const field = collection.fields.getByName("episode")

  if (!field) return null

  collection.fields.remove(field)

  return app.save(collection)
})
