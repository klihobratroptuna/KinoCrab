<script>
	import { Films } from '$lib/blocks/films';
	import { Player } from '$lib/blocks/player';

	let film;
</script>

<div class="page-watch">
	<!-- Заголовок с годом и кнопкой «Назад» переехали в левую колонку панели
		 плеера: так страница читается как одна поверхность. -->
	<Player bind:film={film} />
	<Films type="recomends" />
</div>

<style lang="scss">
	.page-watch {
		display: flex;
		flex-direction: column;
		align-items: center;
		flex: 1 0 0;
		width: 100%;
	}
</style>
