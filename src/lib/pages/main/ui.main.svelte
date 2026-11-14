<script>
	import { LastViwed } from '$lib/blocks/lastViwed';
	import { Releases } from '$lib/blocks/releases';
	import { Trailers } from '$lib/blocks/trailers';
	import ComplexSearch from './complex.search.svelte'
</script>

<div class="page-main">
	<ComplexSearch />
	<!-- Плитки релизов текущей недели сразу под поиском -->
	<Releases basePath="/" />
	<LastViwed />
	<!-- Лента трейлеров — строго под «Последний просмотр» -->
	<Trailers />
</div>

<style lang="scss">
	.page-main {
    display: flex;
    flex-direction: column;
    align-items: center;
		flex: 1 0 0;
	}
</style>
