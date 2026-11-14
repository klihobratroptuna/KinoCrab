<script>
	import { SearchBar } from '$lib/blocks/searchBar';
</script>

<section>
	<SearchBar />
</section>

<style lang="scss">
	section {
		display: flex;
		max-width: 1920px;
		padding: 20px 40px;
		flex-direction: row;
		align-items: center;
		gap: 24px;
		align-self: stretch;

		@media (max-width: 768px) {
			flex: none;
			padding: 16px;
		}
	}
</style>
