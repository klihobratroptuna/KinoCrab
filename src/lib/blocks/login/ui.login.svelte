<script>
	import { LoginProviders } from '$lib/blocks/modals';

	let providerModal = false;
</script>

<button class="login" on:click={() => (providerModal = true)}>
	<p>Войти в аккаунт</p>
	<span>Синхронизация списков на разных устройствах</span>
</button>
<LoginProviders bind:isShow={providerModal} />

<style lang="scss">
	button {
		display: flex;
		flex-direction: column;
		max-width: 1920px;
		padding: 18px 20px;
		gap: 8px;
		align-self: stretch;
		border-radius: 14px;
		background: var(--card, #16161a);
		border: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
		transition: all ease 0.25s;
		cursor: pointer;
		user-select: none;

		@media (max-width: 768px) {
			padding: 16px;
			gap: 8px;
			border-radius: 12px;
			flex-direction: column;
			align-items: flex-start;
		}

		&:active {
			transform: scale(98%);
		}

		@include hover {
			border-color: var(--hairline-hi, rgba(255, 255, 255, 0.14));
			background: var(--card-hi, #1b1b21);
		}
	}

	p {
		font-family: var(--font-family);
		font-weight: 600;
		font-size: 16px;
		letter-spacing: -0.01em;
		line-height: 133%;
		color: var(--white, #fff);

		@media (max-width: 768px) {
			font-family: var(--font-family);
			font-weight: 600;
			font-size: 16px;
			line-height: 133%;
			color: var(--white, #fff);
		}
	}

	span {
		font-family: var(--font-family);
		font-weight: 400;
		font-size: 13px;
		line-height: 129%;
		color: var(--gray-soft, #6a6e77);

		@media (max-width: 768px) {
			font-family: var(--font-family);
			font-weight: 400;
			font-size: 13px;
			line-height: 129%;
			color: var(--gray-soft, #6a6e77);
			text-align: left;
		}
	}
</style>
