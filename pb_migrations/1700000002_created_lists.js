///
migrate(
	(app) => {
		const collection = new Collection({
			name: 'lists',
			type: 'base',
			fields: [
				{
					name: 'user',
					type: 'relation',
					required: true,
					collectionId: app.findCollectionByNameOrId('users').id,
					maxSelect: 1,
					cascadeDelete: false
				},
				{
					name: 'film_id',
					type: 'number',
					required: true,
					maxSelect: 1,
				},
				{
					name: 'status',
					type: 'select',
					required: true,
					values: ['planned', 'view'],
					maxSelect: 1
				}
			],
			indexes: ['CREATE UNIQUE INDEX idx_lists_user_film ON lists (user, film_id)']
		});
		app.save(collection);
	},
	(app) => {
		app.delete(app.findCollectionByNameOrId('lists'));
	}
);
