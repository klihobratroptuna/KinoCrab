<script>
	export let id;
	export let label = '';
	export let checked = false;
</script>

<label class="checkbox" on:input>
	<input type="checkbox" {id} {checked}/>
	<span>{label}</span>
</label>

<style lang="scss">
	.checkbox {
		width: max-content;
	}

	.checkbox > input {
		position: absolute;
		z-index: -1;
		opacity: 0;
	}

	// Чип вместо кружка: та же логика, что у сегментированных переключателей.
	.checkbox > span {
		display: inline-flex;
		align-items: center;
		user-select: none;

		padding: 8px 14px;
		border: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
		border-radius: 10px;
		background: transparent;

		font-family: var(--font-family);
		font-weight: 600;
		font-size: 14px;
		letter-spacing: -0.01em;
		line-height: 129%;
		color: var(--gray, #8b8f98);
		cursor: pointer;
		transition: all 0.25s ease;

		@include hover {
			color: var(--white, #fff);
			border-color: var(--hairline-hi, rgba(255, 255, 255, 0.14));
		}
	}

	// Отметку больше не рисуем кружком: активный чип отличается только заливкой.
	.checkbox > span::before {
		display: none;
	}

	.checkbox > input:not(:disabled):active + span {
		background: rgba(255, 255, 255, 0.07);
		border-color: var(--hairline-hi, rgba(255, 255, 255, 0.14));
	}

	.checkbox > input:focus:not(:checked) + span {
		border-color: var(--hairline-hi, rgba(255, 255, 255, 0.14));
	}

	.checkbox > input:checked + span {
		background: rgba(255, 255, 255, 0.10);
		border-color: var(--hairline-hi, rgba(255, 255, 255, 0.14));
		color: var(--white, #fff);
	}

	.checkbox > input:not(:disabled):checked + span:hover {
		background: rgba(255, 255, 255, 0.14);
	}

	.checkbox > input:disabled + span {
		opacity: 0.45;
	}
</style>
