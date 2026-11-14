import { publish } from 'gh-pages';

publish(
	'build',
	{
		branch: 'gh-pages',
		repo: `https://github.com/klihobratroptuna/KinoCrab.git`,
		src: ['**/*', '.htaccess', '.nojekyll']
	},
	() => {
		console.log('Deploy Complete!');
	}
);
