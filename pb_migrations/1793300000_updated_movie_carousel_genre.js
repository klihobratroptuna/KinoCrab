/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1653049656")

  // add field
  collection.fields.addAt(10, new Field({
    "help": "Первый жанр из ответа Kinopoisk по совпадению названия. Пусто, пока жанра нет — строка под названием тогда только с годом.",
    "hidden": false,
    "id": "text1793300101",
    "max": 0,
    "min": 0,
    "name": "genre",
    "pattern": "",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1653049656")

  // remove field
  collection.fields.removeById("text1793300101")

  return app.save(collection)
})
