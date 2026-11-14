/// <reference path="../pb_data/types.d.ts" />
// Поля страны и даты релиза для ленты фильмов (HotMovies) — коллекция movie_carousel
// (pbc_1653049656). rule-гейт и порядок ленты уже описаны в миграции 1793961000; здесь только два
// новых поля, потому что правила изменились 2026-11-06 вечер.

// Почему поля нужны (замеры 2026-11-06 вечер через прокси http://localhost:3000):
//
// country — страна производства. Строка search/discover через прокси её не отдаёт: keys строки —
// adult, backdrop_path, genre_ids, id, title, original_language, original_title, overview,
// popularity, poster_path, release_date, softcore, video, vote_average, vote_count. Её приносит
// один запрос /movie/{id} (замер: «Обитель зла» id 1183311 → origin_country ["US"], imdb_id
// tt35538033). Поэтому поле пишется из того же запроса, который нужен ветке Alloha: Alloha
// проверяет материал только по номеру, а номера у кандидатов пула раньше не было.
//
// Замер состава ленты до этого правила: все 20 карточек — 2026 год, ни одной американской
// (TH 2, KR 5, ID 2, AU 3, ES 1, IN 4, TR 1, JP 1, CN 1). По новому порядку лента идёт группами:
// сначала производство США, потом другие страны, и внутри группы по дате релиза — убывая.
//
// releaseDate — полная дата релиза, не только год. Год для «более свежие в начале» слишком
// грубый: две карточки 2026 года встали бы в произвольном порядке. По году поле year уже есть
// (миграция 1793961000), здесь храним дату YYYY-MM-DD, чтобы порядок и интерфейс читали её без
// повторного запроса к TMDB.
//
// Индекс — тот же путь, что index по имени и качеству: лента читается фильтром по дню и
// порядковым ключом, и группа страны + дата релиза сравниваются на каждом проходе.
//
// Правила, которые надо помнить: PocketBase принимает только поля схемы, неизвестное поле молча
// отбрасывается. Help короче 300 байт, иначе миграция падает. Миграция устойчива к повторному
// запуску: поле добавляем только если его нет, индекс — только если его нет в списке коллекции.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1653049656")

  const fields = [
    {
      "autogeneratePattern": "",
      "help": "Страна производства кодом TMDB (US, KR). Порядок ленты: сначала США, потом другие страны.",
      "hidden": false,
      "id": "text1794047401",
      "max": 0,
      "min": 0,
      "name": "country",
      "pattern": "",
      "presentable": false,
      "required": false,
      "system": false,
      "type": "text"
    },
    {
      "autogeneratePattern": "",
      "help": "Дата релиза TMDB, YYYY-MM-DD. По ней лента сравнивает свежесть внутри группы страны.",
      "hidden": false,
      "id": "text1794047402",
      "max": 0,
      "min": 0,
      "name": "releaseDate",
      "pattern": "",
      "presentable": false,
      "required": false,
      "system": false,
      "type": "text"
    }
  ]

  for (const definition of fields) {
    if (collection.fields.getByName(definition.name)) continue

    collection.fields.addAt(collection.fields.length, new Field(definition))
  }

  const indexes = [
    "CREATE INDEX IF NOT EXISTS movie_carousel_country_idx ON movie_carousel (country, releaseDate)"
  ]

  for (const index of indexes) {
    if (collection.indexes.some((existing) => String(existing) === index)) continue

    collection.indexes.push(index)
  }

  app.save(collection)

  return null
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1653049656")

  const ids = ["text1794047401", "text1794047402"]

  for (const id of ids) {
    if (collection.fields.some((field) => field.id === id)) collection.fields.removeById(id)
  }

  app.run("DROP INDEX IF EXISTS movie_carousel_country_idx")

  app.save(collection)

  return null
})
