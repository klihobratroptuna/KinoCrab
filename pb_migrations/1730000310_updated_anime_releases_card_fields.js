migrate(
	(app) => {
		const collection = app.findCollectionByNameOrId('anime_releases');

		// Поля карточки для внутренней страницы /anime?id=... (src/lib/pages/anime).
		// Их заполняет scripts/scrape-anime.mjs из GraphQL Shikimori: без этих полей
		// страница аниме показывала бы только постер и дату серии.
		//
		// Дублируются в каждой записи серии одного аниме — сознательно: коллекция
		// строится вокруг «серия = запись», а страница читает самую свежую запись,
		// поэтому отдельная таблица карточек здесь не нужна.
		collection.fields.add(new Field({ name: 'description', type: 'text' }));
		collection.fields.add(new Field({ name: 'score', type: 'number' }));
		// Жанры одной строкой через запятую (русские названия) — так поле работает
		// в любой версии PocketBase, а UI просто делит строку.
		collection.fields.add(new Field({ name: 'genres', type: 'text' }));
		collection.fields.add(new Field({ name: 'episodesTotal', type: 'number' }));

		app.save(collection);
	},
	(app) => {
		const collection = app.findCollectionByNameOrId('anime_releases');

		['description', 'score', 'genres', 'episodesTotal'].forEach((name) => {
			if (collection.fields.has(name)) collection.fields.removeByName(name);
		});

		app.save(collection);
	}
);
