<script>
	import { user, logout } from '$lib/shared/auth';
	import { goto } from '$app/navigation';

	const exit = () => {
		logout();
		goto('/');
	};
</script>

{#if $user}
	<button on:click={exit}>Выйти</button>
{/if}
