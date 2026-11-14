<script>
	import { SearchBar } from '$lib/blocks/searchBar';
</script>

<section>
	<SearchBar />
</section>

<style lang="scss">
	// Строка поиска лежит на фоне страницы: вокруг неё нет панели, скруглённые края
	// у самой строки. Ряд на главной остаётся в тех же отступах, что и остальные блоки.
	section {
		display: flex;
		max-width: 1920px;
		padding: 16px 40px;
		flex-direction: column;
		align-items: stretch;
		gap: 10px;
		/* Строка поиска не растягивается по высоте: она остаётся плотной. */
		flex: none;
		align-self: stretch;

		@media (max-width: 768px) {
			flex: none;
			padding: 16px;
		}
	}
</style>
