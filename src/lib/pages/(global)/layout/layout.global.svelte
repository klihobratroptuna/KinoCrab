<script>
	import { Header } from '$lib/blocks/header';
	import { Footer } from '$lib/blocks/footer';
	import './styles.scss';
</script>

<svelte:head>
	<title>KINOCRAB</title>
</svelte:head>

<main class="app">
	<div class="content-view">
		<Header />
		<slot />
		<Footer />
	</div>
</main>

<style>
	.app {
		/* clip, а не hidden: с hidden родитель становится контейнером прокрутки,
		   и липкая шапка перестаёт держаться на экране. */
		overflow-x: clip;
		background: var(--bg);
		display: flex;
		flex-direction: column;
		align-items: center;
		min-height: 100vh;
	}
	.content-view {
		max-width: 1920px;
		width: 100vw;
		display: flex;
		flex-direction: column;
		min-height: 100vh;
	}
</style>
