<script>
	export let title = '';
	export let year = '';
</script>

<section>
	<h2>{title ?? ''}<span>{year ?? ''}<slot /></span></h2>
</section>

<style lang="scss">
	// Строка заголовка теперь живёт внутри панели плеера, в левой колонке:
	// без внешних отступов. Название — первой строкой, год и чип — второй,
	// под названием, чтобы ниже оставалось больше воздуха для остальных пунктов.
	section {
		display: flex;
		gap: 10px;
		align-items: center;
	}

	h2 {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-weight: 600;
		font-size: 18px;
		line-height: 135%;
		letter-spacing: -0.01em;
		color: var(--white);

		// Вторая строка: год и вставленный чип типа — на одной линии
		span {
			display: flex;
			align-items: center;
			gap: 8px;
			font-weight: 400;
			font-size: 13px;
			line-height: 130%;
			letter-spacing: 0;
			color: var(--gray-soft);
		}
	}
</style>
