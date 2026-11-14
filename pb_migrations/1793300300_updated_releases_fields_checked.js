/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_953728200")

  // add field
  collection.fields.addAt(17, new Field({
    "help": "API ответил по этой записи (даже если жанра и платформ не нашлось). Нужна, чтобы проход по полям не перечитывал одни и те же тайтлы каждый цикл.",
    "hidden": false,
    "id": "bool1793300301",
    "name": "fieldsChecked",
    "required": false,
    "system": false,
    "type": "bool"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_953728200")

  // remove field
  collection.fields.removeById("bool1793300301")

  return app.save(collection)
})
