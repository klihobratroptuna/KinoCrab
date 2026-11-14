/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_953728200")

  // add field
  collection.fields.addAt(12, new Field({
    "help": "Платформы, где тайтл смотрят официально (watchability из API ПоискКино). Пусто, пока данных нет или строк не нашлось.",
    "hidden": false,
    "id": "text1793300201",
    "max": 0,
    "min": 0,
    "name": "platforms",
    "pattern": "",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(13, new Field({
    "help": "Сети производства (networks из API ПоискКино) — это не платформы просмотра, держим отдельно от platforms.",
    "hidden": false,
    "id": "text1793300202",
    "max": 0,
    "min": 0,
    "name": "networks",
    "pattern": "",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(14, new Field({
    "help": "Неудачи запроса подряд по этой записи. При max_fail_count (3) запись перестаём запрашивать — это не суточный лимит, поэтому считаем отдельно.",
    "hidden": false,
    "id": "number1793300203",
    "max": 0,
    "min": 0,
    "name": "failCount",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(15, new Field({
    "help": "Последняя причина неудачи по этой записи.",
    "hidden": false,
    "id": "text1793300204",
    "max": 0,
    "min": 0,
    "name": "failReason",
    "pattern": "",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // add field
  collection.fields.addAt(16, new Field({
    "help": "Запись на паузе из-за трёх неудач подряд. Отличаем от completed: причина не в лимите.",
    "hidden": false,
    "id": "bool1793300205",
    "name": "failPaused",
    "required": false,
    "system": false,
    "type": "bool"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_953728200")

  // remove fields
  collection.fields.removeById("text1793300201")
  collection.fields.removeById("text1793300202")
  collection.fields.removeById("number1793300203")
  collection.fields.removeById("text1793300204")
  collection.fields.removeById("bool1793300205")

  return app.save(collection)
})
