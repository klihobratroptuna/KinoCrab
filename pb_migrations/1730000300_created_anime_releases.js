migrate(
	(app) => {
		const collection = new Collection({
			name: 'anime_releases',
			type: 'base',
			fields: [
				{ name: 'slug', type: 'text' },
				{ name: 'title', type: 'text' },
				{ name: 'titleEn', type: 'text' },
				{ name: 'poster', type: 'url' },
				{ name: 'date', type: 'date' },
				{ name: 'year', type: 'number' },
				// Номер серии, которая выходит в этот день (0 — если серия без номера, например фильм).
				{ name: 'episode', type: 'number' },
				{ name: 'kind', type: 'text' },
				{ name: 'status', type: 'text' },
				{ name: 'shikimoriId', type: 'text' },
				{ name: 'shikimoriUrl', type: 'url' }
			],
			indexes: [
				'CREATE INDEX IF NOT EXISTS anime_releases_slug_idx ON anime_releases (slug)',
				'CREATE INDEX IF NOT EXISTS anime_releases_shikimori_idx ON anime_releases (shikimoriId, date)',
				'CREATE INDEX IF NOT EXISTS anime_releases_date_idx ON anime_releases (date)'
			]
		});

		// Чтение публичное: вкладка «Аниме» работает без авторизации.
		// Запись — только через скрипт-скрапер (superuser), правила на запись не открываем.
		collection.listRule = '';
		collection.viewRule = '';
		collection.createRule = null;
		collection.updateRule = null;
		collection.deleteRule = null;

		app.save(collection);
	},
	(app) => {
		app.delete(app.findCollectionByNameOrId('anime_releases'));
	}
);
