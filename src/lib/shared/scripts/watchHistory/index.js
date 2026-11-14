// Отдельный ключ хранилища для прогресса. Список смотренного (watch_history) не трогает:
// его читают другие блоки, и менять форму записей там рискованно.
const readProgress = () => {
	if (typeof localStorage === 'undefined') return {}

	try {
		return JSON.parse(localStorage.getItem('watch_progress')) || {}
	} catch (error) {
		console.error(error)
		return {}
	}
}

const watchHistory = {
	get: () => {
		try {
			let data = JSON.parse(localStorage.getItem('watch_history'))
			if (!data) {
				localStorage.setItem('watch_history', JSON.stringify([]))
				data = []
			}
			return data
		} catch (error) {
			console.error(error)
		}
	},

	add: (film) => {
		let data = watchHistory.get()

		let target = data.filter((obj) => obj.kinopoiskId == film.kinopoiskId)[0]
		if (target) {
			let index = data.indexOf(target)
			data.splice(index, 1)
		}

		let now = Date.now()
		film = { ...film, _kinofree: { lastviewed: now } }
		data.unshift(film)
		if (data.length > 24) {
			data.pop()
		}
		localStorage.setItem('watch_history', JSON.stringify(data))
	},

	remove: (film) => {
		let data = watchHistory.get()

		let filtered = data.filter((obj) => obj.kinopoiskId != film.kinopoiskId)
		localStorage.setItem('watch_history', JSON.stringify(filtered))
		data = filtered
	},

	// Прогресс знает только наш <video>: сторонние iframe время не отдают, поэтому сюда
	// пишут только файлы, которые играют сами. Значение — секунды для конкретной серии.
	// name и ids пишутся сюда, чтобы карточка «Последний просмотр» могла найти прогресс:
	// в истории просмотра у карточки бывает только имя, без id источника.
	saveProgress: (key, episode, seconds, duration, info = {}) => {
		if (!key || typeof localStorage === 'undefined') return

		const data = readProgress()
		const entry = data[key] || { episodes: {} }

		entry.episodes[episode] = Math.round(seconds)
		entry.duration = Math.round(duration || entry.duration || 0)
		entry.lastviewed = Date.now()
		entry.lastEpisode = episode

		if (info.name) entry.name = String(info.name).toLowerCase()
		if (info.ids?.length) entry.ids = [...new Set([...(entry.ids || []), ...info.ids.map(String)])]
		// Имя серии берём из плейлиста источника, номер по индексу — только запасной вариант:
		// индекс с нуля и имя из comment могут не совпадать.
		if (info.episodeName) entry.episodeNames = { ...(entry.episodeNames || {}), [episode]: info.episodeName }

		data[key] = entry

		// Хранилище не должно расти без конца: держим последние 100 тайтлов
		if (Object.keys(data).length > 100) {
			const stale = Object.entries(data).sort((a, b) => (a[1].lastviewed || 0) - (b[1].lastviewed || 0))
			delete data[stale[0][0]]
		}

		localStorage.setItem('watch_progress', JSON.stringify(data))
	},

	getProgress: (key, episode) => {
		const entry = readProgress()[key]
		if (!entry) return 0

		return Number(entry.episodes?.[episode] || 0)
	},

	// Прогресс для карточки: по любому известному id, иначе по имени. Ключом записи может
	// быть и id источника из адреса, и номер фильма, поэтому сравниваем все числовые поля
	// карточки, плюс slug снимка (carousel-39275). Если совпало несколько записей, берём
	// самую свежую — это тот просмотр, который карточка показывает.
	findProgress: (film) => {
		const data = readProgress()
		if (!data) return null

		const ids = [
			film?.kinopoiskId,
			film?.doramatvId,
			film?.kinovibeId,
			film?.shikimoriId,
			film?.kodikId,
			/^carousel-(\d+)$/.exec(String(film?.slug || ''))?.[1]
		]
			.filter((value) => value !== null && value !== undefined && value !== '')
			.map(String)

		const names = [film?.nameRu, film?.nameEn, film?.nameOriginal]
			.filter(Boolean)
			.map((name) => String(name).toLowerCase())

		const matches = Object.values(data).filter((entry) => {
			if (!entry) return false
			const stored = (entry.ids || []).map(String)
			return ids.some((id) => stored.includes(id)) || (entry.name && names.includes(entry.name))
		})

		if (!matches.length) return null

		const entry = matches.sort((a, b) => (b.lastviewed || 0) - (a.lastviewed || 0))[0]
		const episode = Number(entry.lastEpisode ?? 0)
		const seconds = Number(entry.episodes?.[episode] || 0)
		const duration = Number(entry.duration || 0)

		if (!seconds) return null

		return {
			episode,
			episodeName: entry.episodeNames?.[episode] || '',
			seconds,
			duration,
			percent: duration ? Math.min(100, Math.round((seconds / duration) * 100)) : 0
		}
	}
}

export default watchHistory