/// <reference path="../pb_data/types.d.ts" />
// year, genre, imdbId для трёх каруселей. Имена оставлены те, что уже читает фронтенд:
// kinopoiskId и poster (не kinopoisk_id и poster_url), иначе ui.movieCarousel,
// ui.dramaCarousel и ui.seasonCarousel перестали бы читать поля.
//
// year и genre нужны потому, что их пишет scripts/updater.js: в ответе Kinopoisk они
// приходят в той же строке, что и номер фильма, — отдельного запроса ради них нет.
// imdbId — для строгого пути к плеерам: у Kodik поиск по kinopoisk_id работает, у Alloha
// есть параметр imdb (проверено запросом 2026-10-31: ?imdb=tt20597468 отвечает тем же
// материалом, что и ?kp=4859012). Для «Баларао» imdbId null — у тайтла его просто нет,
// поэтому поле текстовое и пустое, а не обязательное.
migrate((app) => {
  const collections = [
    { id: "pbc_2449271769", name: "drama_carousel" },
    { id: "pbc_1653049656", name: "movie_carousel" },
    { id: "pbc_4285378504", name: "season_carousel" }
  ]

  const added = {}

  for (const entry of collections) {
    const collection = app.findCollectionByNameOrId(entry.id)
    added[entry.name] = []

    const year = new Field({
      "help": "Год тайтла. Приходит из строки Kinopoisk тем же запросом, что и номер фильма.",
      "hidden": false,
      "id": "number1793300501",
      "name": "year",
      "required": false,
      "system": false,
      "type": "number",
      "max": null,
      "min": null
    })

    const genre = new Field({
      "help": "Первый жанр из строки Kinopoisk. Пишем один, как в схеме movie_carousel.",
      "hidden": false,
      "id": "text1793300502",
      "name": "genre",
      "required": false,
      "system": false,
      "type": "text"
    })

    const imdb = new Field({
      "help": "Код IMDb (tt...). Нужен строгому пути к плеерам без поиска по названию; у части тайтлов его нет — тогда поле пустое.",
      "hidden": false,
      "id": "text1793300503",
      "name": "imdbId",
      "required": false,
      "system": false,
      "type": "text"
    })

    for (const field of [year, genre, imdb]) {
      if (collection.fields.getByName(field.name)) continue
      collection.fields.addAt(collection.fields.length, field)
      added[entry.name].push(field.id)
    }

    app.save(collection)
  }

  return null
}, (app) => {
  const collections = [
    { id: "pbc_2449271769", name: "drama_carousel" },
    { id: "pbc_1653049656", name: "movie_carousel" },
    { id: "pbc_4285378504", name: "season_carousel" }
  ]

  for (const entry of collections) {
    const collection = app.findCollectionByNameOrId(entry.id)

    for (const id of ["number1793300501", "text1793300502", "text1793300503"]) {
      if (collection.fields.getByName(id) || collection.fields.some((f) => f.id === id)) {
        collection.fields.removeById(id)
      }
    }

    app.save(collection)
  }

  return null
})
