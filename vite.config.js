import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import babel from 'vite-plugin-babel';

export default defineConfig({
	plugins: [
		sveltekit(),
		babel({babelConfig: {targets: 'defaults, not ie 11, not ie_mob 11'}})
	],
	// В dev-режиме тот же путь, что в продакшене даёт nginx (location /api/pb/).
	// Без него браузер в dev идёт на origin/api/pb, которого dev-сервер не знает,
	// и PocketBase не отвечает. В продакшене этот прокси делает nginx, не vite.
	server: {
		proxy: {
			'/api/pb': {
				target: 'http://localhost:8090',
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/api\/pb/, '')
			}
		}
	}
});
