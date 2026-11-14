/// <reference path="../pb_data/types.d.ts" />
// checkNote и checkDay для всех трёх каруселей. Ранее эти поля были только у drama_carousel,
// поэтому запись отметки в movie_carousel и season_carousel молча терялась: PocketBase
// принимает только поля схемы, неизвестное поле молча отбрасывается. Проверено прогоном:
// --mode all отметки появились только в drama_carousel.
// help короче 300 байт — иначе миграция падает (правило max=300 считается в байтах).
migrate((app) => {
  const collections = ["pbc_2449271769", "pbc_1653049656", "pbc_4285378504"]

  for (const id of collections) {
    const collection = app.findCollectionByNameOrId(id)

    for (const [name, fieldId, help] of [
      ["checkNote", "text1793300601", "Результат проверки по названию. Пустое поле не значит «не нашли»: запрос мог не ответить."],
      ["checkDay", "text1793300602", "День последней проверки тайтла."]
    ]) {
      if (collection.fields.getByName(name)) continue

      collection.fields.addAt(collection.fields.length, new Field({
        "help": help,
        "hidden": false,
        "id": fieldId,
        "name": name,
        "required": false,
        "system": false,
        "type": "text"
      }))
    }

    app.save(collection)
  }

  return null
}, (app) => {
  const collections = ["pbc_2449271769", "pbc_1653049656", "pbc_4285378504"]

  for (const id of collections) {
    const collection = app.findCollectionByNameOrId(id)

    for (const fieldId of ["text1793300601", "text1793300602"]) {
      if (collection.fields.some((field) => field.id === fieldId)) collection.fields.removeById(fieldId)
    }

    app.save(collection)
  }

  return null
})
