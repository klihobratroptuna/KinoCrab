migrate(
	(app) => {
		const collection = app.findCollectionByNameOrId('dorama_releases');

		// Id записи в открытой базе Shikimori. У дорам нет номера фильма в Kinopoisk,
		// поэтому плееры не могут найти их по kinopoiskId. Shikimori принимает дорамы как
		// обычные записи аниме, и по этому id работает Kodik get-player (он отвечает и
		// по публичному токену плеера) — проверено запросом.
		collection.fields.add(new Field({ name: 'shikimoriId', type: 'text' }));

		app.save(collection);
	},
	(app) => {
		const collection = app.findCollectionByNameOrId('dorama_releases');

		if (collection.fields.has('shikimoriId')) {
			collection.fields.removeByName('shikimoriId');
		}

		app.save(collection);
	}
);
