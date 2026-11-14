/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_544223901")

  // add field
  collection.fields.addAt(20, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text1103769220",
    "max": 0,
    "min": 0,
    "name": "country",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_544223901")

  // remove field
  collection.fields.removeById("text1103769220")

  return app.save(collection)
})
