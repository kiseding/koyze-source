/*!
 * @name 巡回寺 QQ + 网易云 + 酷我
 * @description 巡回寺解析 QQ；Netease_url 解析网易云；musicdl 酷我官方 convert_url2（DES）解析可播 flac/320k/128k，歌词走酷我 openapi
 * @version 1.2.1
 * @author kiseding
 *
 * 网易云走 Suxiaoqinx/Netease_url：
 *   线上：POST https://nextmusic.toubiec.cn/api/getSongUrl|getSongLyric
 *   原版：POST {WY_API_BASE}/song  （自建 python main.py 时把 WY_API_BASE 改成你的地址）
 *
 * 酷我走 CharlesPikachu/musicdl：
 *   官方：GET https://mobi.kuwo.cn/mobi.s?f=kuwo&q=DES(ylzsxkwm, convert_url2)
 *         format=flac | format=mp3&br=320kmp3 | format=mp3
 *   回退：haitang / nxinxz
 *   歌词：GET https://www.kuwo.cn/openapi/v1/www/lyric/getlyric
 *   不请求加密 mgg/mflac（沙箱没有 zlib/QMC）
 *
 * body 传对象而不是 JSON.stringify，让 Koyze 引擎按 JSON 编码并写成字节。
 */

const TX_API_URL = 'https://api.xunhuisi.store/API/QQMusic/Song.php'
const WY_API_BASE = 'https://nextmusic.toubiec.cn'
const WY_PAGE_ORIGIN = 'https://wyapi.toubiec.cn'
const KW_MOBI_URL = 'https://mobi.kuwo.cn/mobi.s'
const KW_LYRIC_URL = 'https://www.kuwo.cn/openapi/v1/www/lyric/getlyric'
const KW_PIC_URL = 'https://artistpicserver.kuwo.cn/pic.web'
const KW_ANTI_URL = 'https://antiserver.kuwo.cn/anti.s'
const KW_HAITANG_URL = 'https://musicapi.haitangw.net/music/kw.php'
const KW_NXINXZ_URL = 'https://music.nxinxz.com/kw.php'
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

function requestText(url, options) {
  const opts = options || { method: 'GET' }
  return new Promise((resolve) => {
    lx.request(url, opts, (error, response) => {
      if (error || !response || response.statusCode < 200 || response.statusCode >= 300) {
        resolve(null)
        return
      }
      const body = response.body
      if (typeof body === 'string') {
        resolve(body)
        return
      }
      if (body == null) {
        resolve('')
        return
      }
      resolve(String(body))
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
    body: { timestamp: Date.now() },
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
    body: payload,
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

const KW_LS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1]
const KW_LSMASK = [0, 0x100001, 0x300003]
const KW_E = [31,0,1,2,3,4,-1,-1,3,4,5,6,7,8,-1,-1,7,8,9,10,11,12,-1,-1,11,12,13,14,15,16,-1,-1,15,16,17,18,19,20,-1,-1,19,20,21,22,23,24,-1,-1,23,24,25,26,27,28,-1,-1,27,28,29,30,31,30,-1,-1]
const KW_IP1 = [39,7,47,15,55,23,63,31,38,6,46,14,54,22,62,30,37,5,45,13,53,21,61,29,36,4,44,12,52,20,60,28,35,3,43,11,51,19,59,27,34,2,42,10,50,18,58,26,33,1,41,9,49,17,57,25,32,0,40,8,48,16,56,24]
const KW_IP2 = [57,49,41,33,25,17,9,1,59,51,43,35,27,19,11,3,61,53,45,37,29,21,13,5,63,55,47,39,31,23,15,7,56,48,40,32,24,16,8,0,58,50,42,34,26,18,10,2,60,52,44,36,28,20,12,4,62,54,46,38,30,22,14,6]
const KW_P = [15,6,19,20,28,11,27,16,0,14,22,25,4,17,30,9,1,7,23,13,31,26,2,8,18,12,29,5,21,10,3,24]
const KW_PC1 = [56,48,40,32,24,16,8,0,57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35,62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,60,52,44,36,28,20,12,4,27,19,11,3]
const KW_PC2 = [13,16,10,23,0,4,-1,-1,2,27,14,5,20,9,-1,-1,22,18,11,3,25,7,-1,-1,15,6,26,19,12,1,-1,-1,40,51,30,36,46,54,-1,-1,29,39,50,44,32,47,-1,-1,43,48,38,55,33,52,-1,-1,45,41,49,35,28,31,-1,-1]
const KW_SBOX = [
  [14,4,3,15,2,13,5,3,13,14,6,9,11,2,0,5,4,1,10,12,15,6,9,10,1,8,12,7,8,11,7,0,0,15,10,5,14,4,9,10,7,8,12,3,13,1,3,6,15,12,6,11,2,9,5,0,4,2,11,14,1,7,8,13],
  [15,0,9,5,6,10,12,9,8,7,2,12,3,13,5,2,1,14,7,8,11,4,0,3,14,11,13,6,4,1,10,15,3,13,12,11,15,3,6,0,4,10,1,7,8,4,11,14,13,8,0,6,2,15,9,5,7,1,10,12,14,2,5,9],
  [10,13,1,11,6,8,11,5,9,4,12,2,15,3,2,14,0,6,13,1,3,15,4,10,14,9,7,12,5,0,8,7,13,1,2,4,3,6,12,11,0,13,5,14,6,8,15,2,7,10,8,15,4,9,11,5,9,0,14,3,10,7,1,12],
  [7,10,1,15,0,12,11,5,14,9,8,3,9,7,4,8,13,6,2,1,6,11,12,2,3,0,5,14,10,13,15,4,13,3,4,9,6,10,1,12,11,0,2,5,0,13,14,2,8,15,7,4,15,1,10,7,5,6,12,11,3,8,9,14],
  [2,4,8,15,7,10,13,6,4,1,3,12,11,7,14,0,12,2,5,9,10,13,0,3,1,11,15,5,6,8,9,14,14,11,5,6,4,1,3,10,2,12,15,0,13,2,8,5,11,8,0,15,7,14,9,4,12,7,10,9,1,13,6,3],
  [12,9,0,7,9,2,14,1,10,15,3,4,6,12,5,11,1,14,13,0,2,8,7,13,15,5,4,10,8,3,11,6,10,4,6,11,7,9,0,6,4,2,13,1,9,15,3,8,15,3,1,14,12,5,11,0,2,12,14,7,5,10,8,13],
  [4,1,3,10,15,12,5,0,2,11,9,6,8,7,6,9,11,4,12,15,0,3,10,5,14,13,7,8,13,14,1,2,13,6,14,9,4,1,2,14,11,13,5,0,1,10,8,3,0,11,3,5,9,4,15,2,7,8,12,15,10,7,6,12],
  [13,7,10,0,6,9,5,15,8,4,3,10,11,14,12,5,2,11,9,6,15,12,0,3,4,1,14,13,1,2,7,8,1,2,12,15,10,4,0,3,13,14,6,9,7,8,9,6,15,1,5,12,3,10,14,5,8,7,11,0,4,13,2,11],
]
const KW_KEY_SONG = [121, 108, 122, 115, 120, 107, 119, 109]

function kwBitTest(hi, lo, idx) {
  return idx < 32 ? ((lo >>> idx) & 1) !== 0 : ((hi >>> (idx - 32)) & 1) !== 0
}

function kwBittransform(arr, n, hi, lo) {
  let oHi = 0
  let oLo = 0
  for (let i = 0; i < n; i++) {
    const idx = arr[i]
    if (idx >= 0 && kwBitTest(hi, lo, idx)) {
      if (i < 32) oLo |= 1 << i
      else oHi |= 1 << (i - 32)
    }
  }
  return [oHi >>> 0, oLo >>> 0]
}

function kwShl64(hi, lo, n) {
  if (n <= 0) return [hi, lo]
  if (n >= 64) return [0, 0]
  if (n >= 32) return [(lo << (n - 32)) >>> 0, 0]
  return [((hi << n) | (lo >>> (32 - n))) >>> 0, (lo << n) >>> 0]
}

function kwShr64(hi, lo, n) {
  if (n <= 0) return [hi, lo]
  if (n >= 64) return [0, 0]
  if (n >= 32) return [0, hi >>> (n - 32)]
  return [hi >>> n, ((lo >>> n) | (hi << (32 - n))) >>> 0]
}

function kwBytesTo64(msg, offset, len) {
  let lo = 0
  let hi = 0
  for (let n = 0; n < len; n++) {
    const v = msg[offset + n] & 0xFF
    if (n < 4) lo |= v << (n * 8)
    else hi |= v << ((n - 4) * 8)
  }
  return [hi >>> 0, lo >>> 0]
}

function kwDes64(longs, hi, lo) {
  const ip = kwBittransform(KW_IP2, 64, hi, lo)
  let left = ip[1]
  let right = ip[0]
  for (let i = 0; i < 16; i++) {
    const expanded = kwBittransform(KW_E, 64, 0, right)
    const rHi = (expanded[0] ^ longs[i][0]) >>> 0
    const rLo = (expanded[1] ^ longs[i][1]) >>> 0
    let sOut = 0
    for (let sbi = 7; sbi >= 0; sbi--) {
      const idx = sbi < 4 ? (rLo >>> (sbi * 8)) & 0xFF : (rHi >>> ((sbi - 4) * 8)) & 0xFF
      sOut = ((sOut << 4) | (KW_SBOX[sbi][idx] & 0xF)) >>> 0
    }
    const p = kwBittransform(KW_P, 32, 0, sOut)
    const nextRight = (left ^ p[1]) >>> 0
    left = right
    right = nextRight
  }
  return kwBittransform(KW_IP1, 64, left, right)
}

function kwSubkeys(keyHi, keyLo) {
  let state = kwBittransform(KW_PC1, 56, keyHi, keyLo)
  const longs = new Array(16)
  for (let i = 0; i < 16; i++) {
    const round = KW_LS[i]
    const maskLo = KW_LSMASK[round]
    const left = kwShl64(0, (state[1] & maskLo) >>> 0, 28 - round)
    const right = kwShr64(state[0], (state[1] & (~maskLo >>> 0)) >>> 0, round)
    state = [(left[0] | right[0]) >>> 0, (left[1] | right[1]) >>> 0]
    longs[i] = kwBittransform(KW_PC2, 64, state[0], state[1])
  }
  return longs
}

function kwEncryptQuery(query) {
  const key = kwBytesTo64(KW_KEY_SONG, 0, 8)
  const longs = kwSubkeys(key[0], key[1])
  const msg = []
  for (let i = 0; i < query.length; i++) msg.push(query.charCodeAt(i) & 0xFF)
  const blockCount = Math.floor(msg.length / 8)
  const out = []
  for (let m = 0; m < blockCount; m++) {
    const block = kwBytesTo64(msg, m * 8, 8)
    out.push(kwDes64(longs, block[0], block[1]))
  }
  const rem = msg.length % 8
  const tail = kwBytesTo64(msg, blockCount * 8, rem)
  out.push(kwDes64(longs, tail[0], tail[1]))
  let binary = ''
  for (let i = 0; i < out.length; i++) {
    const hi = out[i][0]
    const lo = out[i][1]
    for (let b = 0; b < 4; b++) binary += String.fromCharCode((lo >>> (b * 8)) & 0xFF)
    for (let b = 0; b < 4; b++) binary += String.fromCharCode((hi >>> (b * 8)) & 0xFF)
  }
  return btoa(binary)
}

function kwRid(musicInfo) {
  let id = String((musicInfo && (musicInfo.songmid || musicInfo.id || musicInfo.hash)) || '')
  if (id.indexOf('MUSIC_') === 0) id = id.slice(6)
  return id
}

function kwPlayableUrl(value) {
  const url = pickHttpUrl(value)
  if (!url) return ''
  const lower = url.toLowerCase()
  if (lower.indexOf('.mflac') >= 0 || lower.indexOf('.mgg') >= 0 || lower.indexOf('.mmp4') >= 0) return ''
  return url
}

function kwGuessType(url) {
  const lower = url.toLowerCase()
  if (
    lower.indexOf('.flac') >= 0 ||
    lower.indexOf('/f000') >= 0 ||
    lower.indexOf('format$flac') >= 0 ||
    lower.indexOf('format=flac') >= 0
  ) {
    return 'flac'
  }
  if (lower.indexOf('m800') >= 0 || lower.indexOf('320k') >= 0 || lower.indexOf('bitrate$320') >= 0) return '320k'
  return '128k'
}

function kwUrlResult(url) {
  const playable = kwPlayableUrl(url)
  if (!playable) return null
  return { url: playable, type: kwGuessType(playable) }
}

function kwPickMobiUrl(text) {
  if (typeof text !== 'string') return ''
  const line = /(?:^|\r?\n)url=([^\r\n]+)/.exec(text)
  if (line) return kwPlayableUrl(line[1])
  const fallback = /https?:\/\/[^\s$"]+/.exec(text)
  return fallback ? kwPlayableUrl(fallback[0]) : ''
}

function kwPad(value, width) {
  let text = String(value)
  while (text.length < width) text = '0' + text
  return text
}

function kwLrclistToLrc(list) {
  if (!Array.isArray(list) || !list.length) return ''
  const lines = []
  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    const text = item && item.lineLyric
    if (typeof text !== 'string' || !text.trim()) continue
    const sec = Number(item.time)
    const ms = Number.isFinite(sec) ? Math.max(0, Math.round(sec * 1000)) : 0
    const mm = kwPad(Math.floor(ms / 60000), 2)
    const ss = kwPad(Math.floor((ms % 60000) / 1000), 2)
    const xx = kwPad(ms % 1000, 3)
    lines.push('[' + mm + ':' + ss + '.' + xx + ']' + text)
  }
  return lines.join('\n')
}

async function kwOfficialUrl(id, format, br) {
  let query =
    'user=0&corp=kuwo&source=kwplayer_ar_5.1.0.0_B_jiakong_vh.apk&p2p=1&type=convert_url2&sig=0&format=' +
    format +
    '&rid=' +
    id
  if (br) query += '&br=' + br
  const text = await requestText(KW_MOBI_URL + '?f=kuwo&q=' + encodeURIComponent(kwEncryptQuery(query)), {
    method: 'GET',
    headers: { 'User-Agent': 'okhttp/3.10.0' },
  })
  const result = kwUrlResult(kwPickMobiUrl(text || ''))
  if (!result) return null
  const bitrate = Number((/(?:^|\r?\n)bitrate=([^\r\n]+)/.exec(text || '') || [])[1])
  if (bitrate === 320) result.type = '320k'
  else if (bitrate === 128) result.type = '128k'
  if (br === '320kmp3' && result.type !== '320k') return null
  return result
}

async function kwThirdPartyUrl(id, level) {
  const urls = [
    KW_HAITANG_URL + '?id=' + encodeURIComponent(id) + '&level=' + level + '&type=json',
    KW_NXINXZ_URL + '?id=' + encodeURIComponent(id) + '&level=' + level + '&type=json',
  ]
  for (let i = 0; i < urls.length; i++) {
    const result = kwUrlResult(pickWyUrl(await requestJson(urls[i])))
    if (result) return result
  }
  return null
}

async function kwAntiUrl(id) {
  const rids = [id, 'MUSIC_' + id]
  for (let i = 0; i < rids.length; i++) {
    const text = await requestText(
      KW_ANTI_URL + '?type=convert_url&rid=' + encodeURIComponent(rids[i]) + '&format=mp3&response=url',
      { method: 'GET', headers: { 'User-Agent': 'okhttp/3.10.0' } },
    )
    const result = kwUrlResult((text || '').trim())
    if (result) return result
  }
  return null
}

async function handleKw(action, info) {
  const id = kwRid((info && info.musicInfo) || {})
  if (!id) return null

  if (action === 'pic') {
    const text = await requestText(
      KW_PIC_URL + '?corp=kuwo&type=rid_pic&pictype=500&size=500&rid=' + encodeURIComponent(id),
      { method: 'GET', headers: { Referer: 'https://www.kuwo.cn/' } },
    )
    const url = kwPlayableUrl((text || '').trim())
    return url ? { url: url } : null
  }

  if (action === 'lyric') {
    const data = await requestJson(KW_LYRIC_URL + '?musicId=' + encodeURIComponent(id), {
      method: 'GET',
      headers: { Referer: 'https://www.kuwo.cn/' },
    })
    const list = data && data.data && data.data.lrclist
    const lyric = kwLrclistToLrc(list)
    return lyric ? { lyric: lyric } : null
  }

  if (action !== 'musicUrl') return null

  const quality = info && info.type
  if (quality === '320k') {
    return (
      (await kwOfficialUrl(id, 'mp3', '320kmp3')) ||
      (await kwThirdPartyUrl(id, 'exhigh')) ||
      (await kwAntiUrl(id))
    )
  }
  if (quality === 'flac' || quality === 'flac24bit' || quality === 'hires') {
    return (await kwOfficialUrl(id, 'flac')) || (await kwThirdPartyUrl(id, 'lossless'))
  }
  if (quality === '128k') {
    return (await kwOfficialUrl(id, 'mp3')) || (await kwThirdPartyUrl(id, 'standard')) || (await kwAntiUrl(id))
  }
  return null
}

lx.on(lx.EVENT_NAMES.request, ({ action, source, info }) => {
  if (source === 'tx') return handleTx(action, info)
  if (source === 'wy') return handleWy(action, info)
  if (source === 'kw') return handleKw(action, info)
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
    kw: {
      type: 'music',
      actions: ['musicUrl', 'lyric', 'pic'],
      qualitys: ['128k', '320k', 'flac', 'flac24bit', 'hires'],
    },
  },
})
