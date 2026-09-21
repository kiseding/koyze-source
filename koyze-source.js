/*!
 * @name 巡回寺 QQ + 网易云
 * @description 巡回寺 API 解析 QQ Music 的 128k、320k；Netease_url 解析网易云 128k / 320k / flac / hires 与歌词
 * @version 1.1.0
 * @author kiseding
 *
 * 网易云走 Suxiaoqinx/Netease_url：
 *   线上：POST https://nextmusic.toubiec.cn/api/getSongUrl|getSongLyric
 *   原版：POST {WY_API_BASE}/song  （自建 python main.py 时把 WY_API_BASE 改成你的地址）
 */

const TX_API_URL = 'https://api.xunhuisi.store/API/QQMusic/Song.php'
const WY_API_BASE = 'https://nextmusic.toubiec.cn'
const WY_PAGE_ORIGIN = 'https://wyapi.toubiec.cn'
const TX_QUALITY_MAP = {
  '128k': 'standard',
  '320k': 'high',
}
const WY_QUALITY_MAP = {
  '128k': 'standard',
  '320k': 'exhigh',
  flac: 'lossless',
  flac24bit: 'hires',
  hires: 'hires',
}
const WY_LEVEL_TO_TYPE = {
  standard: '128k',
  exhigh: '320k',
  lossless: 'flac',
  hires: 'hires',
}

function requestJson(url, options) {
  const opts = options || { method: 'GET' }
  return new Promise((resolve) => {
    lx.request(url, opts, (error, response) => {
      if (error || !response || response.statusCode < 200 || response.statusCode >= 300) {
        resolve(null)
        return
      }

      try {
        const body = response.body
        resolve(typeof body === 'string' ? JSON.parse(body) : body)
      } catch (_) {
        resolve(null)
      }
    })
  })
}

function wyHeaders() {
  return {
    'Content-Type': 'application/json',
    Origin: WY_PAGE_ORIGIN,
    Referer: WY_PAGE_ORIGIN + '/',
  }
}

function wyOk(data) {
  if (!data || typeof data !== 'object') return false
  if (data.success === true) return true
  const code = data.code == null ? data.status : data.code
  return Number(code) === 200
}

let wySession = null

async function wyEnsureSession() {
  if (wySession && Date.now() - wySession.at < 10 * 60 * 1000) return wySession

  const data = await requestJson(WY_API_BASE + '/api/ip', {
    method: 'POST',
    headers: wyHeaders(),
    body: JSON.stringify({ timestamp: Date.now() }),
  })
  const ip = data && data.data && data.data.ip
  wySession = { ip: ip ? String(ip) : '', at: Date.now() }
  return wySession
}

async function wyPost(path, extra, useSession) {
  const payload = {}
  const keys = Object.keys(extra || {})
  for (let i = 0; i < keys.length; i++) payload[keys[i]] = extra[keys[i]]

  if (useSession) {
    const session = await wyEnsureSession()
    payload.timestamp = Date.now()
    if (session && session.ip) payload.ip = session.ip
  }

  return requestJson(WY_API_BASE + path, {
    method: 'POST',
    headers: wyHeaders(),
    body: JSON.stringify(payload),
  })
}

function pickHttpUrl(value) {
  if (typeof value !== 'string') return ''
  const url = value.trim()
  return /^https?:\/\//.test(url) ? url : ''
}

function pickWyUrl(data) {
  if (!data || typeof data !== 'object') return ''
  return (
    pickHttpUrl(data.url) ||
    pickHttpUrl(data.music_url) ||
    (data.data && !Array.isArray(data.data) ? pickHttpUrl(data.data.url) : '') ||
    (data.data && data.data[0] ? pickHttpUrl(data.data[0].url) : '')
  )
}

function pickLyricText(value) {
  if (typeof value === 'string') return value
  if (value && typeof value.lyric === 'string') return value.lyric
  return ''
}

function wyUrlResult(data) {
  const url = pickWyUrl(data)
  if (!url) return null
  const payload = data && data.data && !Array.isArray(data.data) ? data.data : data
  const result = { url: url }
  const type = WY_LEVEL_TO_TYPE[payload && payload.level]
  if (type) result.type = type
  return result
}

function wyLyricResult(data) {
  const payload = data && data.data ? data.data : data
  const lyric =
    pickLyricText(payload && payload.lrc) ||
    pickLyricText(payload && payload.lyric)
  if (!lyric) return null
  const tlyric = pickLyricText(payload && payload.tlyric)
  const result = { lyric: lyric }
  if (tlyric) result.tlyric = tlyric
  return result
}

function handleTx(action, info) {
  const musicInfo = (info && info.musicInfo) || {}
  const id = musicInfo.songmid || musicInfo.id || musicInfo.hash
  if (!id) return Promise.resolve(null)

  const quality = TX_QUALITY_MAP[info && info.type]
  if (action === 'musicUrl' && !quality) return Promise.resolve(null)
  if (action !== 'musicUrl' && action !== 'lyric') return Promise.resolve(null)

  const query = ['id=' + encodeURIComponent(id)]
  if (quality) query.push('quality=' + quality)

  return requestJson(TX_API_URL + '?' + query.join('&')).then((data) => {
    if (!data || Number(data.code) !== 200) return null
    if (action === 'musicUrl') {
      const url = pickHttpUrl(data.music_url)
      return url ? { url: url } : null
    }
    const lyric = typeof data.lyric === 'string' ? data.lyric : ''
    return lyric ? { lyric: lyric } : null
  })
}

async function handleWy(action, info) {
  const musicInfo = (info && info.musicInfo) || {}
  const id = musicInfo.songmid || musicInfo.id || musicInfo.hash
  if (!id) return null
  if (action !== 'musicUrl' && action !== 'lyric') return null

  if (action === 'lyric') {
    let data = await wyPost('/api/getSongLyric', { id: String(id) }, true)
    let result = wyOk(data) ? wyLyricResult(data) : null
    if (result) return result

    data = await wyPost(
      '/song',
      { id: String(id), ids: String(id), type: 'lyric' },
      false,
    )
    return wyOk(data) ? wyLyricResult(data) : null
  }

  const level = WY_QUALITY_MAP[info && info.type]
  if (!level) return null

  let data = await wyPost('/api/getSongUrl', { id: String(id), level: level }, true)
  let result = wyOk(data) ? wyUrlResult(data) : null
  if (result) return result

  data = await wyPost(
    '/song',
    { id: String(id), ids: String(id), level: level, type: 'url' },
    false,
  )
  return wyOk(data) ? wyUrlResult(data) : null
}

lx.on(lx.EVENT_NAMES.request, ({ action, source, info }) => {
  if (source === 'tx') return handleTx(action, info)
  if (source === 'wy') return handleWy(action, info)
  return null
})

lx.send(lx.EVENT_NAMES.inited, {
  status: true,
  sources: {
    tx: {
      type: 'music',
      actions: ['musicUrl', 'lyric'],
      qualitys: ['128k', '320k'],
    },
    wy: {
      type: 'music',
      actions: ['musicUrl', 'lyric'],
      qualitys: ['128k', '320k', 'flac', 'flac24bit', 'hires'],
    },
  },
})
