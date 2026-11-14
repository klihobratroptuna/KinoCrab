migrate(
	(app) => {
		const collection = new Collection({
			name: 'films',
			type: 'base',
			fields: [
				{ name: 'nameRu', type: 'text' },
				{ name: 'nameEn', type: 'text' },
				{ name: 'nameOriginal', type: 'text' },
				{ name: 'year', type: 'number' },
				{ name: 'type', type: 'text' },
				{ name: 'relationType', type: 'text' },
				{ name: 'description', type: 'text' },
				{ name: 'rating', type: 'number' },
				{ name: 'ratingKinopoisk', type: 'number' },
				{ name: 'ratingImdb', type: 'number' },
				{ name: 'kinopoiskId', type: 'text' },
				{ name: 'posterUrl', type: 'url' },
				{ name: 'posterUrlPreview', type: 'url' }
			]
		});
		app.save(collection);
	},
	(app) => {
		app.delete(app.findCollectionByNameOrId('films'));
	}
);
