/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3622903276")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE INDEX IF NOT EXISTS dorama_releases_doramatv_idx ON dorama_releases (doramatvId)",
      "CREATE INDEX IF NOT EXISTS dorama_releases_date_idx ON dorama_releases (date)",
      "CREATE INDEX IF NOT EXISTS `dorama_releases_name_key_idx` ON `dorama_releases` (`nameKey`)"
    ]
  }, collection)

  // add field
  collection.fields.addAt(16, new Field({
    "autogeneratePattern": "",
    "help": "Нормализованное название для поиска по имени (без регистра и пунктуации): резервный путь, когда id источника пуст.",
    "hidden": false,
    "id": "text1793300701",
    "max": 0,
    "min": 0,
    "name": "nameKey",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3622903276")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE INDEX IF NOT EXISTS dorama_releases_doramatv_idx ON dorama_releases (doramatvId)",
      "CREATE INDEX IF NOT EXISTS dorama_releases_date_idx ON dorama_releases (date)"
    ]
  }, collection)

  // remove field
  collection.fields.removeById("text1793300701")

  return app.save(collection)
})
