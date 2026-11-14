migrate(
	(app) => {
		const collection = new Collection({
			name: 'releases',
			type: 'base',
			fields: [
				{ name: 'slug', type: 'text' },
				{ name: 'title', type: 'text' },
				{ name: 'titleEn', type: 'text' },
				{ name: 'poster', type: 'url' },
				{ name: 'date', type: 'date' },
				{ name: 'year', type: 'number' },
				{ name: 'kinopoiskId', type: 'text' }
			],
			indexes: [
				'CREATE INDEX IF NOT EXISTS releases_slug_idx ON releases (slug)',
				'CREATE INDEX IF NOT EXISTS releases_date_idx ON releases (date)'
			]
		});

		// Чтение публичное: страница /releases работает без авторизации.
		// Запись — только через скрипт-скрапер (superuser), правила на запись не открываем.
		collection.listRule = '';
		collection.viewRule = '';
		collection.createRule = null;
		collection.updateRule = null;
		collection.deleteRule = null;

		app.save(collection);
	},
	(app) => {
		app.delete(app.findCollectionByNameOrId('releases'));
	}
);
