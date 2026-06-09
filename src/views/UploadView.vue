<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref} from 'vue'
import {useRouter} from 'vue-router'
import {
  getUploadToken,
  getUserProfile,
  listSongMedias,
  moveSongMedia,
  saveHeadlessMusicUpload,
  saveMusicUpload,
  searchSongs,
} from '@/services/emos'
import {uploadMusicFile} from '@/services/tusUpload'
import type {MusicMedia, MusicSong, UserProfile} from '@/types/music'
import {cleanArtistName, isAudioFile, readTrackMetadata, type LocalTrackMetadata} from '@/utils/metadata'
import {matchTrackToSongs, type SongMatch} from '@/utils/matching'
import useSignStore from '@/stores/sign'

type TrackStatus =
    | 'parsed'
    | 'matched'
    | 'confirm'
    | 'unmatched'
    | 'waiting_retry'
    | 'headless'
    | 'requesting_token'
    | 'uploading'
    | 'saving'
    | 'saved'
    | 'failed'

type DetailTab = 'match' | 'headless'
type MatchSearchMode = 'artist' | 'song'

const ARTIST_PAGE_SIZE = 100

interface UploadTrack {
  id: string
  file: File
  meta: LocalTrackMetadata
  status: TrackStatus
  artistQuery: string
  matchSearchMode: MatchSearchMode
  headlessDraft: HeadlessDraft
  selectedSong: MusicSong | null
  duplicateMedia: MusicMedia | null
  checkedMediaSongId: number | null
  isCheckingMediaDuplicate: boolean
  matches: SongMatch[]
  manualQuery: string
  uploadProgress: number
  bytesUploaded: number
  bytesTotal: number
  fileId: string
  mediaId: string
  savedSongId: number | null
  error: string
  retryAt: number | null
  isHeadless: boolean
}

interface HeadlessDraft {
  nameSong: string
  namePerson: string
  description: string
  releaseDate: string
  isAdult: boolean
}

interface TrackGroup {
  name: string
  tracks: UploadTrack[]
  loaded: number
  ready: number
  saved: number
  unresolved: number
  size: number
}

const router = useRouter()
const sign = useSignStore()
const user = ref<UserProfile | null>(null)
const tracks = ref<UploadTrack[]>([])
const candidateCache = ref<Record<string, MusicSong[]>>({})
const loadingArtists = ref<string[]>([])
const selectedTrackId = ref('')
const activeDetailTab = ref<DetailTab>('match')
const isParsing = ref(false)
const isUploading = ref(false)
const dragActive = ref(false)
const notice = ref('')
const now = ref(Date.now())
const earnedCarrot = ref(0)

const selectedTrack = computed(() => tracks.value.find((track) => track.id === selectedTrackId.value) ?? tracks.value[0] ?? null)
const readyTracks = computed(() =>
    tracks.value.filter((track) => canUploadMatchedTrack(track) || (track.status === 'headless' && isHeadlessDraftValid(track))),
)
const savedCount = computed(() => tracks.value.filter((track) => track.status === 'saved').length)
const unresolvedCount = computed(() =>
    tracks.value.filter((track) => ['confirm', 'unmatched', 'waiting_retry', 'failed'].includes(track.status)).length,
)
const totalSize = computed(() => tracks.value.reduce((sum, track) => sum + track.file.size, 0))
const trackGroups = computed<TrackGroup[]>(() => {
  const groups = new Map<string, UploadTrack[]>()

  for (const track of tracks.value) {
    const artist = track.artistQuery.trim() || '未识别歌手'
    const groupTracks = groups.get(artist) ?? []
    groupTracks.push(track)
    groups.set(artist, groupTracks)
  }

  return [...groups.entries()].map(([name, groupTracks]) => ({
    name,
    tracks: groupTracks,
    loaded: name !== '未识别歌手' ? candidateCache.value[name]?.length ?? 0 : 0,
    ready: groupTracks.filter((track) => canUploadMatchedTrack(track) || (track.status === 'headless' && isHeadlessDraftValid(track))).length,
    saved: groupTracks.filter((track) => track.status === 'saved').length,
    unresolved: groupTracks.filter((track) => ['confirm', 'unmatched', 'waiting_retry', 'failed'].includes(track.status)).length,
    size: groupTracks.reduce((sum, track) => sum + track.file.size, 0),
  }))
})
const candidateTotalCount = computed(() =>
    Object.values(candidateCache.value).reduce((sum, songs) => sum + songs.length, 0),
)
const canLoadCandidates = computed(() => tracks.value.some((track) => track.artistQuery.trim()))
const displayAvatar = computed(() => sign.avatar || '')

const clock = window.setInterval(() => {
  now.value = Date.now()
}, 1000)

onMounted(async () => {
  await loadUser()
})

onUnmounted(() => {
  window.clearInterval(clock)
})

async function loadUser() {
  try {
    user.value = await getUserProfile()
    sign.setProfile({
      userId: user.value.user_id,
      username: user.value.username,
      avatar: user.value.avatar,
      roles: user.value.roles,
    })
  } catch (error) {
    notice.value = formatError(error)
  }
}

async function signOut() {
  await sign.signOut()
  await router.replace('/login')
}

async function handleFileInput(event: Event) {
  const input = event.target as HTMLInputElement
  await prepareFiles(Array.from(input.files ?? []))
  input.value = ''
}

async function handleDrop(event: DragEvent) {
  dragActive.value = false
  await prepareFiles(Array.from(event.dataTransfer?.files ?? []))
}

async function prepareFiles(files: File[]) {
  const audioFiles = files.filter(isAudioFile)

  if (!audioFiles.length) {
    notice.value = '没有识别到可上传的音频文件'
    return
  }

  isParsing.value = true
  notice.value = `正在解析 ${audioFiles.length} 个音频文件`

  try {
    const metadatas = await mapLimit(audioFiles, 4, readTrackMetadata)
    const relativePaths = metadatas.map((meta) => meta.relativePath)

    tracks.value = metadatas.map((meta, index) => ({
      id: crypto.randomUUID(),
      file: audioFiles[index],
      meta,
      status: 'parsed',
      artistQuery: meta.artist || inferPathArtistForBatch(meta.relativePath, relativePaths) || meta.folderArtist,
      matchSearchMode: 'artist',
      headlessDraft: createHeadlessDraft(meta, meta.artist || inferPathArtistForBatch(meta.relativePath, relativePaths) || meta.folderArtist),
      selectedSong: null,
      duplicateMedia: null,
      checkedMediaSongId: null,
      isCheckingMediaDuplicate: false,
      matches: [],
      manualQuery: meta.title,
      uploadProgress: 0,
      bytesUploaded: 0,
      bytesTotal: meta.duration ?? 0,
      fileId: '',
      mediaId: '',
      savedSongId: null,
      error: '',
      retryAt: null,
      isHeadless: false,
    }))
    candidateCache.value = {}
    selectedTrackId.value = tracks.value[0]?.id ?? ''
    notice.value = trackGroups.value.length
        ? `已识别 ${trackGroups.value.length} 个歌手分组`
        : '已解析文件，请为歌曲填写搜索歌手后加载候选'

    if (canLoadCandidates.value) {
      await reloadCandidatesAndMatch()
    }
  } catch (error) {
    notice.value = formatError(error)
  } finally {
    isParsing.value = false
  }
}

async function reloadCandidatesAndMatch() {
  const artists = uniqueTrackArtists()

  if (!artists.length) {
    notice.value = '请先填写至少一个搜索歌手'
    return
  }

  notice.value = `正在按 ${artists.length} 个歌手加载候选歌曲`

  try {
    for (const artist of artists) {
      await loadArtistSongsUntilResolved(artist, tracks.value.filter((track) => track.artistQuery.trim() === artist))
    }

    notice.value = `已加载 ${candidateTotalCount.value} 首候选歌曲，匹配由前端完成`
  } catch (error) {
    notice.value = formatError(error)
  }
}

async function reloadGroupCandidates(group: TrackGroup) {
  if (group.name === '未识别歌手') {
    notice.value = '请先在右侧为这组歌曲填写歌手名'
    return
  }

  notice.value = `正在按「${group.name}」加载候选歌曲`

  try {
    await loadArtistSongsUntilResolved(group.name, group.tracks)
    notice.value = `已按「${group.name}」加载 ${candidateCache.value[group.name]?.length ?? 0} 首候选`
  } catch (error) {
    notice.value = formatError(error)
  }
}

function applyAutoMatch(track: UploadTrack) {
  const artist = track.artistQuery.trim()
  const songs = artist ? candidateCache.value[artist] ?? [] : []

  track.error = ''
  track.isHeadless = false
  track.retryAt = null

  if (!artist) {
    track.status = 'unmatched'
    track.selectedSong = null
    track.matches = []
    track.error = '缺少搜索歌手，请在右侧为这首歌填写'
    return
  }

  if (!songs.length) {
    track.status = 'unmatched'
    track.selectedSong = null
    track.matches = []
    track.error = '当前歌手没有候选歌曲，请检查歌手名或稍后重试'
    return
  }

  const result = matchTrackToSongs(track.meta, songs)
  track.matches = result.alternatives

  if (result.status === 'matched' && result.best) {
    track.status = 'matched'
    track.selectedSong = result.best.song
    void checkExactDuplicateMedia(track)
    return
  }

  if (result.status === 'confirm') {
    track.status = 'confirm'
    track.selectedSong = null
    return
  }

  track.status = 'unmatched'
  track.selectedSong = null
}

async function manualSearch(track: UploadTrack) {
  const query = track.manualQuery.trim()

  if (!query) return

  track.error = ''
  track.matchSearchMode = 'song'

  try {
    const result = await searchSongs({
      name: query,
      pageSize: ARTIST_PAGE_SIZE,
    })
    const manualTrack = {
      ...track.meta,
      title: query,
    }
    const matchResult = matchTrackToSongs(manualTrack, result.items)
    track.matches = matchResult.alternatives
    track.status = matchResult.alternatives.length ? 'confirm' : 'unmatched'
    track.selectedSong = null
    track.error = matchResult.alternatives.length ? '' : '歌名搜索没有结果，可以等待系统同步或保存为群星'
  } catch (error) {
    track.error = formatError(error)
  }
}

function pickMatch(track: UploadTrack, song: MusicSong) {
  const wasSaved = track.status === 'saved' && Boolean(track.mediaId)
  track.selectedSong = song
  track.duplicateMedia = null
  track.checkedMediaSongId = null
  track.status = wasSaved ? 'saved' : 'matched'
  track.isHeadless = false
  track.retryAt = null
  track.error = ''
  activeDetailTab.value = 'match'
  void checkExactDuplicateMedia(track)
}

function waitRetry(track: UploadTrack) {
  track.status = 'waiting_retry'
  track.retryAt = Date.now() + 180_000
  track.error = ''
}

async function retryTrack(track: UploadTrack) {
  const artist = track.artistQuery.trim()

  if (!artist) {
    track.error = '请先填写这首歌的搜索歌手'
    return
  }

  await loadArtistSongsUntilResolved(artist, [track])

  if (track.status === 'unmatched') {
    track.error = '重试后仍未匹配到，可以手动搜索或保存为群星'
  }
}

function markHeadless(track: UploadTrack) {
  if (track.status === 'saved') {
    activeDetailTab.value = 'headless'
    return
  }

  ensureHeadlessDraft(track)
  track.status = 'headless'
  track.isHeadless = true
  track.selectedSong = null
  track.retryAt = null
  track.error = ''
  activeDetailTab.value = 'headless'
}

async function uploadAsHeadless(track: UploadTrack) {
  if (track.status === 'saved') {
    return
  }

  markHeadless(track)
  await uploadOneTrack(track)
}

async function uploadReadyTracks() {
  if (isUploading.value) return

  isUploading.value = true

  try {
    for (const track of readyTracks.value) {
      if (track.status === 'saved') continue
      await uploadOneTrack(track)
    }
  } finally {
    isUploading.value = false
  }
}

function selectTrack(track: UploadTrack) {
  selectedTrackId.value = track.id
  activeDetailTab.value = track.status === 'headless' || track.isHeadless ? 'headless' : 'match'
}

function isBusyTrack(track: UploadTrack): boolean {
  return ['requesting_token', 'uploading', 'saving'].includes(track.status)
}

function removeTrack(track: UploadTrack) {
  if (isBusyTrack(track)) return

  const nextTracks = tracks.value.filter((item) => item.id !== track.id)
  tracks.value = nextTracks

  if (selectedTrackId.value === track.id) {
    selectedTrackId.value = nextTracks[0]?.id ?? ''
  }
}

function removeSavedTracks() {
  const nextTracks = tracks.value.filter((track) => track.status !== 'saved')
  tracks.value = nextTracks

  if (selectedTrack.value?.status === 'saved') {
    selectedTrackId.value = nextTracks[0]?.id ?? ''
  }
}

function clearUploadQueue() {
  const busyTracks = tracks.value.filter(isBusyTrack)

  if (busyTracks.length && !window.confirm(`有 ${busyTracks.length} 个文件正在上传或保存。清空队列会保留这些项目，继续吗？`)) {
    return
  }

  tracks.value = busyTracks
  selectedTrackId.value = busyTracks[0]?.id ?? ''
}

function clearTrackArtistQuery(track: UploadTrack) {
  if (isBusyTrack(track)) return

  track.artistQuery = ''
  resetTrackMatchState(track)
}

function clearTrackManualQuery(track: UploadTrack) {
  if (isBusyTrack(track)) return

  track.manualQuery = ''
}

function handleTrackArtistQueryInput(track: UploadTrack) {
  if (isBusyTrack(track)) return

  resetTrackMatchState(track)
}

function resetTrackMatchState(track: UploadTrack) {
  track.matches = []
  track.retryAt = null

  if (track.status === 'saved') {
    return
  }

  track.selectedSong = null
  track.duplicateMedia = null
  track.checkedMediaSongId = null
  track.isCheckingMediaDuplicate = false

  if (track.status !== 'headless') {
    track.status = 'parsed'
    track.error = ''
  }
}

async function uploadOneTrack(track: UploadTrack) {
  if (track.status === 'saved') {
    return
  }

  if (track.status === 'matched' && (await hasExactDuplicateBeforeUpload(track))) {
    return
  }

  if (track.status !== 'matched' && track.status !== 'headless') return
  if (track.status === 'headless' && !isHeadlessDraftValid(track)) {
    track.error = '群星模式至少需要填写歌名和歌手'
    return
  }

  try {
    track.status = 'requesting_token'
    track.error = ''
    const token = await getUploadToken({
      file: track.file,
    })

    if (token.type !== 'tusd') {
      throw new Error(`不支持的上传类型：${token.type}`)
    }

    track.fileId = token.file_id
    track.status = 'uploading'
    const tusResult = await uploadMusicFile({
      endpoint: token.data.upload_url,
      file: track.file,
      fileId: token.file_id,
      onProgress(percent, bytesUploaded, bytesTotal) {
        track.uploadProgress = percent
        track.bytesUploaded = bytesUploaded
        track.bytesTotal = bytesTotal
      },
    })
    const uploadedFileId = tusResult.file_id || token.file_id

    track.status = 'saving'

    const saved = track.isHeadless
        ? await saveHeadlessMusicUpload({
          name_song: track.headlessDraft.nameSong.trim() || track.meta.title || track.file.name,
          name_person: track.headlessDraft.namePerson.trim() || track.artistQuery || track.meta.artist || '群星',
          description: track.headlessDraft.description.trim(),
          release_date: track.headlessDraft.releaseDate || null,
          is_adult: track.headlessDraft.isAdult,
          image_poster_url: null,
          file_id: uploadedFileId,
        })
        : await saveMusicUpload(track.selectedSong?.song_id ?? 0, uploadedFileId)

    track.mediaId = saved.media_id
    track.savedSongId = track.isHeadless ? null : track.selectedSong?.song_id ?? null
    track.status = 'saved'
    track.uploadProgress = 100
    earnedCarrot.value += saved.carrot ?? 0
  } catch (error) {
    track.status = 'failed'
    track.error = await formatUploadError(error)
  }
}

async function loadArtistSongsUntilResolved(artist: string, artistTracks: UploadTrack[]): Promise<void> {
  let page = 1
  let pageCount = 1
  const songs: MusicSong[] = []
  const seenSongIds = new Set<number>()

  startArtistLoading(artist)

  try {
    while (page <= pageCount && (page === 1 || hasUnresolvedTracksForArtist(artistTracks))) {
      const result = await searchSongs({
        personNameArtist: artist,
        page,
        pageSize: ARTIST_PAGE_SIZE,
      })
      pageCount = Math.ceil(result.total / ARTIST_PAGE_SIZE)

      for (const song of result.items) {
        if (seenSongIds.has(song.song_id)) continue
        seenSongIds.add(song.song_id)
        songs.push(song)
      }

      candidateCache.value = {
        ...candidateCache.value,
        [artist]: songs,
      }

      for (const track of artistTracks) {
        if (shouldSkipCandidateMatch(track)) continue
        track.matchSearchMode = 'artist'
        applyAutoMatch(track)
      }

      page += 1
    }
  } finally {
    stopArtistLoading(artist)
  }
}

async function reloadTrackCandidates(track: UploadTrack) {
  const artist = track.artistQuery.trim()

  if (!artist) {
    track.error = '请先填写这首歌的搜索歌手'
    return
  }

  track.error = ''
  track.matchSearchMode = 'artist'

  try {
    await loadArtistSongsUntilResolved(artist, [track])
    notice.value = `已按「${artist}」加载 ${candidateCache.value[artist].length} 首候选`
  } catch (error) {
    track.error = formatError(error)
  }
}

function startArtistLoading(artist: string) {
  if (!loadingArtists.value.includes(artist)) {
    loadingArtists.value = [...loadingArtists.value, artist]
  }
}

function stopArtistLoading(artist: string) {
  loadingArtists.value = loadingArtists.value.filter((item) => item !== artist)
}

function isArtistLoading(artist: string): boolean {
  return Boolean(artist && loadingArtists.value.includes(artist))
}

function uniqueTrackArtists(): string[] {
  return [...new Set(tracks.value.map((track) => track.artistQuery.trim()).filter(Boolean))]
}

function inferPathArtistForBatch(relativePath: string, allRelativePaths: string[]): string {
  const dirs = getPathDirs(relativePath)

  if (!dirs.length) return ''
  if (dirs.length === 1) return dirs[0]

  const allDirs = allRelativePaths.map(getPathDirs).filter((item) => item.length)
  const firstDir = dirs[0]
  const allShareFirstDir = allDirs.every((item) => item[0] === firstDir)

  if (allShareFirstDir && isGenericMusicRoot(firstDir)) {
    return dirs[1] ?? firstDir
  }

  return firstDir
}

function getPathDirs(relativePath: string): string[] {
  return relativePath
      .split('/')
      .slice(0, -1)
      .map(cleanArtistName)
      .filter(Boolean)
}

function isGenericMusicRoot(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  const genericRoots = new Set([
    'music',
    'musics',
    'songs',
    'audio',
    'audios',
    'download',
    'downloads',
    'flac',
    'mp3',
    '音乐',
    '歌曲',
    '歌单',
    '合集',
    '下载',
    '无损',
  ])

  return genericRoots.has(normalized)
}

function createHeadlessDraft(meta: LocalTrackMetadata, artist: string): HeadlessDraft {
  return {
    nameSong: meta.title || meta.fileName,
    namePerson: artist || meta.artist || '群星',
    description: meta.album || artist || meta.artist || '',
    releaseDate: '',
    isAdult: false,
  }
}

function ensureHeadlessDraft(track: UploadTrack) {
  if (!track.headlessDraft.nameSong.trim()) {
    track.headlessDraft.nameSong = track.meta.title || track.file.name
  }

  if (!track.headlessDraft.namePerson.trim()) {
    track.headlessDraft.namePerson = track.artistQuery || track.meta.artist || '群星'
  }

  if (!track.headlessDraft.description.trim()) {
    track.headlessDraft.description = track.meta.album || track.artistQuery || track.meta.artist || ''
  }
}

function isHeadlessDraftValid(track: UploadTrack): boolean {
  return Boolean(track.headlessDraft.nameSong.trim() && track.headlessDraft.namePerson.trim())
}

function canUploadMatchedTrack(track: UploadTrack): boolean {
  return track.status === 'matched' && Boolean(track.selectedSong) && !track.isCheckingMediaDuplicate && !track.duplicateMedia
}

function canMoveSavedMediaTrack(track: UploadTrack): boolean {
  return (
      track.status === 'saved' &&
      Boolean(track.mediaId) &&
      Boolean(track.selectedSong) &&
      track.selectedSong?.song_id !== track.savedSongId &&
      !track.isCheckingMediaDuplicate &&
      !track.duplicateMedia
  )
}

function canRunMatchedAction(track: UploadTrack): boolean {
  return canUploadMatchedTrack(track) || canMoveSavedMediaTrack(track)
}

function matchedUploadButtonText(track: UploadTrack): string {
  if (track.isCheckingMediaDuplicate) return '正在检查已有资源'
  if (track.status === 'saved' && track.selectedSong?.song_id === track.savedSongId) return '已保存，不能重复保存'
  if (track.duplicateMedia) return '已有相同资源，不能重复上传'
  if (canMoveSavedMediaTrack(track)) return '移动资源到此歌曲'
  if (track.status === 'saved') return '已保存，不能重复保存'
  if (isBusyTrack(track)) return '处理中'

  return '上传并保存到关联歌曲'
}

async function runMatchedAction(track: UploadTrack) {
  if (canMoveSavedMediaTrack(track)) {
    await moveSavedMediaTrack(track)
    return
  }

  await uploadOneTrack(track)
}

async function moveSavedMediaTrack(track: UploadTrack) {
  const targetSong = track.selectedSong

  if (!targetSong || !track.mediaId || targetSong.song_id === track.savedSongId) return

  if (await hasExactDuplicateBeforeUpload(track)) {
    return
  }

  const previousStatus = track.status
  track.status = 'saving'
  track.error = ''

  try {
    const moved = await moveSongMedia(targetSong.song_id, track.mediaId)
    track.savedSongId = targetSong.song_id
    track.status = 'saved'
    earnedCarrot.value += moved.carrot ?? 0
    notice.value = `已将资源移动到「${targetSong.name}」`
  } catch (error) {
    track.status = previousStatus
    track.error = formatError(error)
  }
}

async function hasExactDuplicateBeforeUpload(track: UploadTrack): Promise<boolean> {
  if (!track.selectedSong) return false

  if (track.checkedMediaSongId !== track.selectedSong.song_id) {
    await checkExactDuplicateMedia(track)
  }

  return Boolean(track.duplicateMedia)
}

async function checkExactDuplicateMedia(track: UploadTrack): Promise<void> {
  const song = track.selectedSong

  track.duplicateMedia = null
  track.checkedMediaSongId = song?.song_id ?? null

  if (!song || !song.has_media && !song.count_medias) {
    return
  }

  track.isCheckingMediaDuplicate = true

  try {
    const medias = await listSongMedias(song.song_id)
    track.duplicateMedia = medias.find((media) => isSameLocalFile(track.file, media)) ?? null
  } catch (error) {
    track.checkedMediaSongId = null
    track.error = `检查已有资源失败：${formatError(error)}`
  } finally {
    track.isCheckingMediaDuplicate = false
  }
}

function isSameLocalFile(file: File, media: MusicMedia): boolean {
  if (media.file_size !== file.size) {
    return false
  }

  const localSuffix = getFileSuffix(file.name)
  const remoteSuffix = media.file_suffix.toLowerCase()

  if (localSuffix && remoteSuffix && localSuffix === remoteSuffix) {
    return true
  }

  return Boolean(file.type && areCompatibleFileTypes(file.type, media.file_type))
}

function getFileSuffix(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? ''
}

function areCompatibleFileTypes(localType: string, remoteType: string): boolean {
  const local = normalizeFileType(localType)
  const remote = normalizeFileType(remoteType)

  return Boolean(local && remote && local === remote)
}

function normalizeFileType(value: string): string {
  const normalized = value.toLowerCase().replace('music/', 'audio/')
  const aliases: Record<string, string> = {
    'audio/mp3': 'audio/mpeg',
    'audio/x-mpeg': 'audio/mpeg',
    'audio/x-flac': 'audio/flac',
    'audio/mp4': 'audio/mp4',
    'audio/x-m4a': 'audio/mp4',
  }

  return aliases[normalized] ?? normalized
}

function hasUnresolvedTracksForArtist(artistTracks: UploadTrack[]): boolean {
  return artistTracks.some((track) => !shouldSkipCandidateMatch(track) && track.status !== 'matched' && track.status !== 'confirm')
}

function shouldSkipCandidateMatch(track: UploadTrack): boolean {
  return ['saved', 'headless', 'uploading', 'saving', 'requesting_token'].includes(track.status)
}

function retryRemaining(track: UploadTrack): string {
  if (!track.retryAt) return ''

  const seconds = Math.max(0, Math.ceil((track.retryAt - now.value) / 1000))
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60

  return `${minutes}:${String(rest).padStart(2, '0')}`
}

function statusText(status: TrackStatus): string {
  const text: Record<TrackStatus, string> = {
    parsed: '待匹配',
    matched: '已匹配',
    confirm: '需确认',
    unmatched: '未匹配',
    waiting_retry: '等待重试',
    headless: '群星草稿',
    requesting_token: '获取上传凭证',
    uploading: '上传中',
    saving: '保存中',
    saved: '已保存',
    failed: '失败',
  }

  return text[status]
}

function statusClass(status: TrackStatus): string {
  if (status === 'matched' || status === 'saved') return 'bg-[#d6f5eb] text-[#075345]'
  if (status === 'confirm' || status === 'waiting_retry' || status === 'headless') return 'bg-[#fff0c2] text-[#7a4a00]'
  if (status === 'failed' || status === 'unmatched') return 'bg-[#ffe1d8] text-[#8f2f17]'
  if (status === 'uploading' || status === 'saving' || status === 'requesting_token') return 'bg-[#dcecff] text-[#184d87]'
  return 'bg-[#ece4d6] text-[#5f5445]'
}

function statusAccentClass(status: TrackStatus): string {
  if (status === 'matched' || status === 'saved') return 'bg-[#18a999]'
  if (status === 'confirm' || status === 'waiting_retry' || status === 'headless') return 'bg-[#b45309]'
  if (status === 'failed' || status === 'unmatched') return 'bg-[#8f2f17]'
  if (status === 'uploading' || status === 'saving' || status === 'requesting_token') return 'bg-[#2563eb]'
  return 'bg-[#a79a86]'
}

function formatSize(value: number): string {
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function artistLine(song: MusicSong): string {
  return song.person_artists.map((artist) => artist.name).join(' / ') || '未知歌手'
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败'
}

async function formatUploadError(error: unknown): Promise<string> {
  const response = getErrorResponse(error)

  if (response) {
    try {
      const data = (await response.clone().json()) as { message?: string }

      if (data.message) {
        return `后台提示：${data.message}。如果这份资源已经上传过，不要重复保存；请到群星关联页移动已有媒体。`
      }
    } catch {
      // Fall through to generic error formatting.
    }
  }

  return formatError(error)
}

function getErrorResponse(error: unknown): Response | null {
  if (typeof error !== 'object' || error === null || !('response' in error)) {
    return null
  }

  const response = (error as { response?: unknown }).response

  return response instanceof Response ? response : null
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length)
  let nextIndex = 0

  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await worker(items[index])
    }
  }

  await Promise.all(Array.from({length: Math.min(limit, items.length)}, run))

  return results
}
</script>

<template>
  <main class="min-h-screen overflow-x-hidden bg-[#f4efe5] text-[#17130c]">
    <div
        class="fixed inset-0 -z-10 bg-[radial-gradient(circle_at_12%_4%,rgba(24,169,153,0.2),transparent_30%),radial-gradient(circle_at_88%_18%,rgba(180,83,9,0.2),transparent_30%),linear-gradient(135deg,#f8f1e3,#eadfcd)]"></div>
    <div
        class="pointer-events-none fixed inset-0 -z-10 opacity-[0.18] [background-image:linear-gradient(rgba(23,19,12,.16)_1px,transparent_1px),linear-gradient(90deg,rgba(23,19,12,.14)_1px,transparent_1px)] [background-size:42px_42px]"></div>

    <header class="sticky top-0 z-20 border-b border-[#17130c]/10 bg-[#f4efe5]/85 backdrop-blur-xl">
      <div class="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <div>
          <p class="text-xs font-black uppercase tracking-[0.28em] text-[#0f766e]">music upload</p>
          <h1 class="text-2xl font-black tracking-[-0.05em] sm:text-3xl">音乐上传</h1>
        </div>
        <nav
            class="flex items-center gap-2 rounded-full border border-[#17130c]/10 bg-white/45 p-1 shadow-sm shadow-[#17130c]/5">
          <RouterLink class="rounded-full bg-[#17130c] px-4 py-2 text-sm font-bold text-[#f8f1e3]" to="/upload">音乐上传
          </RouterLink>
          <RouterLink class="rounded-full px-4 py-2 text-sm font-bold text-[#5f5445] hover:bg-white/70" to="/headless">
            群星关联
          </RouterLink>
          <button class="rounded-full px-4 py-2 text-sm font-bold text-[#8f2f17] hover:bg-white/70" type="button"
                  @click="signOut">
            退出
          </button>
        </nav>
      </div>
    </header>

    <section
        class="mx-auto grid max-w-[1680px] items-start gap-5 px-4 py-5 sm:px-5 lg:grid-cols-[0.78fr_1.34fr_1.08fr] xl:gap-6">
      <aside class="space-y-5 lg:sticky lg:top-24">
        <div
            class="reveal-card overflow-hidden rounded-[2rem] border border-[#17130c]/10 bg-[#17130c] p-6 text-[#f8f1e3] shadow-xl shadow-[#17130c]/15">
          <div class="flex items-center gap-3">
            <img
                v-if="displayAvatar"
                :src="displayAvatar"
                alt=""
                class="h-12 w-12 rounded-full object-cover"
            >
            <div v-else class="grid h-12 w-12 place-items-center rounded-full bg-[#18a999] font-black text-[#071411]">
              {{ (sign.username || 'U').slice(0, 1).toUpperCase() }}
            </div>
            <div>
              <p class="font-black">{{ sign.username || user?.username }}</p>
              <p class="text-sm text-[#d7c8ac]">
                {{ user?.is_can_upload ? '允许上传' : '未获得上传权限' }} · {{ sign.isAdmin ? '管理员' : '用户' }}
              </p>
            </div>
          </div>
          <div class="mt-6 grid grid-cols-3 gap-2 text-center">
            <div class="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10">
              <p class="text-2xl font-black">{{ tracks.length }}</p>
              <p class="text-xs text-[#d7c8ac]">文件</p>
            </div>
            <div class="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10">
              <p class="text-2xl font-black">{{ readyTracks.length }}</p>
              <p class="text-xs text-[#d7c8ac]">可上传</p>
            </div>
            <div class="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10">
              <p class="text-2xl font-black">{{ earnedCarrot }}</p>
              <p class="text-xs text-[#d7c8ac]">本次萝卜</p>
            </div>
          </div>
        </div>

        <label
            class="group block rounded-[2rem] border border-dashed p-2 transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-[#17130c]/10"
            :class="dragActive ? 'border-[#18a999] bg-[#d9fff7]' : 'border-[#17130c]/20 bg-white/70'"
            @dragover.prevent="dragActive = true"
            @dragleave.prevent="dragActive = false"
            @drop.prevent="handleDrop"
        >
          <input class="hidden" multiple type="file" accept="audio/*" @change="handleFileInput">
          <div class="rounded-[1.6rem] bg-[#fffaf0] p-5">
            <div class="flex items-start gap-4">
              <div
                  class="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#18a999] text-sm font-black text-[#071411] shadow-lg shadow-[#18a999]/20">
                单曲
              </div>
              <div class="min-w-0">
                <p class="text-2xl font-black tracking-[-0.05em]">按单曲上传</p>
                <p class="mt-2 text-sm leading-6 text-[#6d6252]">
                  可拖拽音乐文件至此
                </p>
                <p class="mt-4 inline-flex rounded-full bg-[#17130c] px-3 py-1 text-xs font-black text-[#f8f1e3] group-hover:bg-[#0f766e]">
                  选择文件
                </p>
              </div>
            </div>
          </div>
        </label>

        <label
            class="group block rounded-[2rem] border border-[#17130c]/10 bg-white/70 p-2 shadow-lg shadow-[#17130c]/5 transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-[#17130c]/10">
          <input class="hidden" multiple type="file" webkitdirectory directory @change="handleFileInput">
          <div class="rounded-[1.6rem] bg-[#17130c] p-5 text-[#f8f1e3]">
            <div class="flex items-start gap-4">
              <div
                  class="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#b45309] text-sm font-black text-white shadow-lg shadow-[#b45309]/25">
                目录
              </div>
              <div class="min-w-0">
                <p class="text-2xl font-black tracking-[-0.05em]">按目录上传</p>
                <p class="mt-2 text-sm leading-6 text-[#d7c8ac]">
                  一次不要选太多哦
                </p>
                <p class="mt-4 inline-flex rounded-full bg-[#f8f1e3] px-3 py-1 text-xs font-black text-[#17130c] group-hover:bg-[#18a999]">
                  选择文件夹
                </p>
              </div>
            </div>
          </div>
        </label>

      </aside>

      <section
          class="reveal-card rounded-[2rem] border border-[#17130c]/10 bg-white/78 p-4 shadow-xl shadow-[#17130c]/10 backdrop-blur">
        <div
            class="flex flex-wrap items-start justify-between gap-4 rounded-[1.5rem] bg-[#fffaf0]/80 px-4 py-4 ring-1 ring-[#17130c]/5">
          <div>
            <h2 class="text-2xl font-black tracking-[-0.05em]">上传队列</h2>
            <p class="mt-1 text-sm text-[#6d6252]">
              {{ notice || '选择文件夹后开始解析' }} · 歌手 {{ trackGroups.length }} 组 · 候选 {{ candidateTotalCount }}
              · 待处理 {{ unresolvedCount }} · 总大小 {{ formatSize(totalSize) }}
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
                class="rounded-2xl border border-[#17130c]/10 bg-white/75 px-4 py-3 text-sm font-black text-[#40382d] hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                :disabled="!savedCount"
                @click="removeSavedTracks"
            >
              移除已完成
            </button>
            <button
                class="rounded-2xl border border-[#8f2f17]/20 bg-[#ffe1d8] px-4 py-3 text-sm font-black text-[#8f2f17] hover:bg-[#ffd4c7] disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                :disabled="!tracks.length"
                @click="clearUploadQueue"
            >
              清空队列
            </button>
            <button
                class="rounded-2xl bg-[#17130c] px-5 py-3 text-sm font-black text-[#f8f1e3] shadow-lg shadow-[#17130c]/15 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                :disabled="!readyTracks.length || isUploading"
                @click="uploadReadyTracks"
            >
              {{ isUploading ? '上传中' : `上传可保存项 ${readyTracks.length}` }}
            </button>
          </div>
        </div>

        <div v-if="isParsing"
             class="m-2 mt-4 rounded-2xl bg-[#fff0c2] p-4 text-sm font-bold text-[#7a4a00] ring-1 ring-[#b45309]/10">
          正在读取音频元信息，请保持页面打开。
        </div>

        <div v-if="!tracks.length"
             class="m-2 mt-4 grid min-h-[460px] place-items-center rounded-[1.75rem] border border-dashed border-[#17130c]/15 bg-[#fffaf0]/85 text-center">
          <div>
            <p class="text-4xl font-black tracking-[-0.06em]">先选择歌曲或文件夹</p>
            <p class="mt-3 text-[#6d6252]">文件夹可以混合多个歌手，页面会按每首歌的歌手分别搜索。</p>
          </div>
        </div>

        <div v-else class="scroll-soft mt-4 max-h-[calc(100vh-190px)] space-y-4 overflow-auto pr-1">
          <section
              v-for="group in trackGroups"
              :key="group.name"
              class="rounded-[1.75rem] border border-[#17130c]/10 bg-[#f1e7d7]/70 p-3 shadow-sm shadow-[#17130c]/5"
          >
            <div
                class="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-[1.35rem] bg-[#17130c] px-4 py-3 text-[#f8f1e3] shadow-lg shadow-[#17130c]/10">
              <div>
                <p class="text-lg font-black tracking-[-0.04em]">{{ group.name }}</p>
                <p class="mt-1 text-xs text-[#d7c8ac]">
                  {{ group.tracks.length }} 首 · 可上传 {{ group.ready }} · 完成 {{ group.saved }} · 待处理
                  {{ group.unresolved }} · 候选 {{ group.loaded }} · {{ formatSize(group.size) }}
                </p>
              </div>
              <button
                  class="rounded-2xl bg-[#18a999] px-3 py-2 text-xs font-black text-[#071411] shadow-md shadow-[#18a999]/20 disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  :disabled="isArtistLoading(group.name) || group.name === '未识别歌手'"
                  @click="reloadGroupCandidates(group)"
              >
                {{ isArtistLoading(group.name) ? '匹配中' : '匹配本组' }}
              </button>
            </div>

            <div class="mt-3 space-y-3">
              <div
                  v-for="track in group.tracks"
                  :key="track.id"
                  class="relative w-full cursor-pointer overflow-hidden rounded-[1.5rem] border p-4 pl-5 text-left transition hover:-translate-y-0.5"
                  :class="selectedTrack?.id === track.id ? 'border-[#18a999] bg-[#ecfffb] shadow-lg shadow-[#18a999]/10' : 'border-[#17130c]/10 bg-[#fffaf0] hover:border-[#17130c]/20'"
                  role="button"
                  tabindex="0"
                  @click="selectTrack(track)"
                  @keyup.enter="selectTrack(track)"
              >
                <div class="absolute inset-y-4 left-0 w-1 rounded-r-full"
                     :class="statusAccentClass(track.status)"></div>
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="min-w-0">
                    <p class="truncate text-lg font-black tracking-[-0.03em]">{{
                        track.meta.title || track.file.name
                      }}</p>
                    <p class="mt-1 truncate text-sm text-[#6d6252]">
                      {{ track.artistQuery || '未知歌手' }} · {{ track.meta.relativePath }}
                    </p>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="rounded-full px-3 py-1 text-xs font-black" :class="statusClass(track.status)">
                      {{ statusText(track.status) }}
                    </span>
                    <button
                        v-if="!isBusyTrack(track)"
                        class="rounded-full bg-white/80 px-3 py-1 text-xs font-black text-[#8f2f17] hover:bg-[#ffe1d8]"
                        type="button"
                        @click.stop="removeTrack(track)"
                    >
                      移除
                    </button>
                  </div>
                </div>

                <div class="mt-3 grid gap-2 text-sm text-[#40382d] sm:grid-cols-3">
                  <p>大小 {{ formatSize(track.file.size) }}</p>
                  <p>时长 {{ track.meta.duration ? `${Math.round(track.meta.duration)}s` : '-' }}</p>
                  <p>匹配 {{ track.matches[0] ? `${Math.round(track.matches[0].score * 100)}%` : '-' }}</p>
                </div>

                <div v-if="track.status === 'uploading' || track.status === 'saved'"
                     class="mt-3 h-2 overflow-hidden rounded-full bg-[#e1d7c7]">
                  <div class="h-full rounded-full bg-[#18a999]" :style="{ width: `${track.uploadProgress}%` }"></div>
                </div>

                <p v-if="track.error" class="mt-3 rounded-xl bg-[#ffe1d8] px-3 py-2 text-sm font-bold text-[#8f2f17]">
                  {{ track.error }}
                </p>
              </div>
            </div>
          </section>
        </div>
      </section>

      <aside
          class="reveal-card scroll-soft rounded-[2rem] border border-[#17130c]/10 bg-white/78 p-5 shadow-xl shadow-[#17130c]/10 backdrop-blur lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-auto xl:p-6">
        <template v-if="selectedTrack">
          <div class="rounded-[1.75rem] bg-[#17130c] p-5 text-[#f8f1e3] shadow-lg shadow-[#17130c]/10">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="text-xs font-black uppercase tracking-[0.24em] text-[#8ff1e4]">当前歌曲</p>
                <h2 class="mt-2 break-words text-2xl font-black tracking-[-0.05em]">
                  {{ selectedTrack.meta.title || selectedTrack.file.name }}</h2>
              </div>
              <span class="shrink-0 rounded-full px-3 py-1 text-xs font-black"
                    :class="statusClass(selectedTrack.status)">
                {{ statusText(selectedTrack.status) }}
              </span>
            </div>
          </div>

          <dl class="mt-4 grid gap-2 rounded-[1.5rem] bg-[#fffaf0] p-4 text-sm ring-1 ring-[#17130c]/5">
            <div class="flex justify-between gap-3">
              <dt class="text-[#6d6252]">歌手</dt>
              <dd class="text-right font-bold">{{ selectedTrack.meta.artist || '-' }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-[#6d6252]">专辑</dt>
              <dd class="text-right font-bold">{{ selectedTrack.meta.album || '-' }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-[#6d6252]">异常</dt>
              <dd class="text-right font-bold">{{ selectedTrack.meta.parseError || '无' }}</dd>
            </div>
          </dl>

          <div class="mt-5 grid grid-cols-2 gap-2 rounded-[1.75rem] bg-[#e9dfce] p-2">
            <button
                class="rounded-[1.15rem] px-4 py-3 text-sm font-black transition"
                :class="activeDetailTab === 'match' ? 'bg-[#17130c] text-[#f8f1e3] shadow-lg shadow-[#17130c]/15' : 'text-[#5f5445] hover:bg-white/60'"
                type="button"
                @click="activeDetailTab = 'match'"
            >
              关联已有歌曲
            </button>
            <button
                class="rounded-[1.15rem] px-4 py-3 text-sm font-black transition"
                :class="activeDetailTab === 'headless' ? 'bg-[#b45309] text-white shadow-lg shadow-[#b45309]/15' : 'text-[#5f5445] hover:bg-white/60'"
                type="button"
                @click="activeDetailTab = 'headless'; ensureHeadlessDraft(selectedTrack)"
            >
              保存为群星
            </button>
          </div>

          <template v-if="activeDetailTab === 'match'">
            <div class="mt-5 rounded-[1.75rem] bg-[#fffaf0] p-5 ring-1 ring-[#17130c]/5">
              <div>
                <h3 class="font-black">搜索关联歌曲</h3>
                <p class="mt-1 text-sm leading-6 text-[#6d6252]">
                  优先按歌手拉候选库再自动匹配；如果歌手不确定，切到歌名搜索，搜索时不会带歌手条件。
                </p>
              </div>

              <div class="mt-4 grid grid-cols-2 gap-2 rounded-[1.25rem] bg-[#e9dfce] p-1.5">
                <button
                    class="rounded-[1rem] px-3 py-2 text-sm font-black"
                    :class="selectedTrack.matchSearchMode === 'artist' ? 'bg-[#17130c] text-[#f8f1e3]' : 'text-[#5f5445] hover:bg-white/60'"
                    type="button"
                    @click="selectedTrack.matchSearchMode = 'artist'"
                >
                  按歌手候选
                </button>
                <button
                    class="rounded-[1rem] px-3 py-2 text-sm font-black"
                    :class="selectedTrack.matchSearchMode === 'song' ? 'bg-[#17130c] text-[#f8f1e3]' : 'text-[#5f5445] hover:bg-white/60'"
                    type="button"
                    @click="selectedTrack.matchSearchMode = 'song'"
                >
                  按歌名搜索
                </button>
              </div>

              <label v-if="selectedTrack.matchSearchMode === 'artist'"
                     class="mt-4 block text-sm font-black text-[#40382d]">
                歌手名
                <span class="relative mt-2 block">
                  <input
                      v-model="selectedTrack.artistQuery"
                      class="field-input"
                      placeholder="例如：周杰伦"
                      type="text"
                      @input="handleTrackArtistQueryInput(selectedTrack)"
                      @keyup.enter="reloadTrackCandidates(selectedTrack)"
                  >
                  <button
                      v-if="selectedTrack.artistQuery"
                      class="clear-button"
                      type="button"
                      aria-label="清空歌手名"
                      @click="clearTrackArtistQuery(selectedTrack)"
                  >
                    <span aria-hidden="true">x</span>
                  </button>
                </span>
              </label>
              <button
                  v-if="selectedTrack.matchSearchMode === 'artist'"
                  class="mt-3 w-full rounded-2xl bg-[#18a999] px-4 py-3 text-sm font-black text-[#071411] disabled:opacity-50"
                  type="button"
                  :disabled="isArtistLoading(selectedTrack.artistQuery.trim()) || !selectedTrack.artistQuery.trim()"
                  @click="reloadTrackCandidates(selectedTrack)"
              >
                {{ isArtistLoading(selectedTrack.artistQuery.trim()) ? '候选加载中' : '拉取候选并自动匹配' }}
              </button>

              <label v-if="selectedTrack.matchSearchMode === 'song'"
                     class="mt-4 block text-sm font-black text-[#40382d]">
                歌名关键字
                <span class="relative mt-2 block">
                  <input
                      v-model="selectedTrack.manualQuery"
                      class="field-input"
                      placeholder="只按歌名搜索，不带歌手"
                      type="text"
                      @keyup.enter="manualSearch(selectedTrack)"
                  >
                  <button
                      v-if="selectedTrack.manualQuery"
                      class="clear-button"
                      type="button"
                      aria-label="清空歌名关键字"
                      @click="clearTrackManualQuery(selectedTrack)"
                  >
                    <span aria-hidden="true">x</span>
                  </button>
                </span>
              </label>
              <button
                  v-if="selectedTrack.matchSearchMode === 'song'"
                  class="mt-3 w-full rounded-2xl bg-[#17130c] px-4 py-3 text-sm font-black text-[#f8f1e3] disabled:opacity-50"
                  type="button"
                  :disabled="!selectedTrack.manualQuery.trim()"
                  @click="manualSearch(selectedTrack)"
              >
                按歌名查找歌曲
              </button>
            </div>

            <div v-if="selectedTrack.selectedSong"
                 class="mt-4 rounded-[1.5rem] border border-[#18a999]/30 bg-[#ecfffb] p-4 shadow-sm shadow-[#18a999]/10">
              <p class="text-sm font-black text-[#075345]">已关联</p>
              <h3 class="mt-1 text-xl font-black tracking-[-0.04em]">{{ selectedTrack.selectedSong.name }}</h3>
              <p class="mt-1 text-sm text-[#3d7168]">{{ artistLine(selectedTrack.selectedSong) }}</p>
              <p
                  v-if="selectedTrack.duplicateMedia"
                  class="mt-3 rounded-2xl bg-[#ffe1d8] px-3 py-2 text-sm font-bold text-[#8f2f17]"
              >
                已有完全相同资源：{{
                  selectedTrack.duplicateMedia.media_id
                }}，{{ formatSize(selectedTrack.duplicateMedia.file_size) }}。
              </p>
            </div>

            <div class="mt-5 rounded-[1.75rem] bg-white/45 p-4 ring-1 ring-[#17130c]/5">
              <div class="flex items-center justify-between">
                <h3 class="font-black">选择正确歌曲</h3>
                <button
                    v-if="selectedTrack.status === 'unmatched'"
                    class="text-sm font-black text-[#0f766e]"
                    type="button"
                    @click="waitRetry(selectedTrack)"
                >
                  等待 3 分钟重试
                </button>
              </div>

              <div v-if="selectedTrack.status === 'waiting_retry'"
                   class="mt-3 rounded-2xl bg-[#fff0c2] p-3 text-sm font-bold text-[#7a4a00]">
                倒计时 {{ retryRemaining(selectedTrack) }}
                <button class="ml-2 underline" type="button" @click="retryTrack(selectedTrack)">立即重试</button>
              </div>

              <div class="mt-3 space-y-2">
                <button
                    v-for="match in selectedTrack.matches"
                    :key="match.song.song_id"
                    class="w-full rounded-2xl border border-[#17130c]/10 bg-[#fffaf0] p-3 text-left transition hover:-translate-y-0.5 hover:border-[#18a999] hover:shadow-md hover:shadow-[#18a999]/10"
                    type="button"
                    @click="pickMatch(selectedTrack, match.song)"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <p class="font-black">{{ match.song.name }}</p>
                      <p class="mt-1 text-xs text-[#6d6252]">{{ artistLine(match.song) }} · {{ match.reason }}</p>
                    </div>
                    <span class="rounded-full bg-[#17130c] px-2 py-1 text-xs font-black text-[#f8f1e3]">
                      {{ Math.round(match.score * 100) }}%
                    </span>
                  </div>
                </button>
              </div>

              <p v-if="!selectedTrack.matches.length" class="mt-3 rounded-2xl bg-[#f1e7d7] p-3 text-sm text-[#6d6252]">
                当前没有候选。可以切换搜索方式重试，或切到“保存为群星”。
              </p>
            </div>

            <button
                class="mt-5 w-full rounded-[1.35rem] bg-[#18a999] px-5 py-4 font-black text-[#071411] shadow-lg shadow-[#18a999]/20 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                :disabled="!canRunMatchedAction(selectedTrack)"
                @click="runMatchedAction(selectedTrack)"
            >
              {{ matchedUploadButtonText(selectedTrack) }}
            </button>
          </template>

          <template v-else>
            <div
                class="mt-5 rounded-[1.75rem] border border-[#b45309]/20 bg-[#fff7df] p-5 shadow-sm shadow-[#b45309]/10">
              <h3 class="font-black">群星版本信息</h3>
              <p class="mt-1 text-sm leading-6 text-[#7a4a00]">
                这些信息会提交到群星版本。之后可以在群星关联页把媒体移动到正确歌曲。
              </p>

              <div class="mt-4 grid gap-3">
                <label class="block text-sm font-black text-[#40382d]">
                  歌名
                  <input
                      v-model="selectedTrack.headlessDraft.nameSong"
                      class="mt-2 w-full rounded-2xl border border-[#17130c]/10 bg-white/90 px-4 py-3 outline-none focus:border-[#b45309]"
                      placeholder="例如：稻香"
                      type="text"
                  >
                </label>
                <label class="block text-sm font-black text-[#40382d]">
                  歌手
                  <input
                      v-model="selectedTrack.headlessDraft.namePerson"
                      class="mt-2 w-full rounded-2xl border border-[#17130c]/10 bg-white/90 px-4 py-3 outline-none focus:border-[#b45309]"
                      placeholder="例如：周杰伦"
                      type="text"
                  >
                </label>
                <label class="block text-sm font-black text-[#40382d]">
                  简介
                  <textarea
                      v-model="selectedTrack.headlessDraft.description"
                      class="mt-2 min-h-24 w-full rounded-2xl border border-[#17130c]/10 bg-white/90 px-4 py-3 outline-none focus:border-[#b45309]"
                      placeholder="可填写专辑、来源、版本说明等"
                  ></textarea>
                </label>
                <div class="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <label class="block text-sm font-black text-[#40382d]">
                    发布日期
                    <input
                        v-model="selectedTrack.headlessDraft.releaseDate"
                        class="mt-2 w-full rounded-2xl border border-[#17130c]/10 bg-white/90 px-4 py-3 outline-none focus:border-[#b45309]"
                        type="date"
                    >
                  </label>
                  <label
                      class="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 text-sm font-black text-[#40382d] sm:mt-7">
                    <input
                        v-model="selectedTrack.headlessDraft.isAdult"
                        class="h-4 w-4 accent-[#b45309]"
                        type="checkbox"
                    >
                    少儿不宜
                  </label>
                </div>
              </div>
            </div>

            <div class="mt-6 grid gap-3">
              <button
                  class="rounded-[1.35rem] border border-[#17130c]/15 px-5 py-4 font-black text-[#40382d] disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  :disabled="!isHeadlessDraftValid(selectedTrack) || selectedTrack.status === 'saved'"
                  @click="markHeadless(selectedTrack)"
              >
                {{ selectedTrack.status === 'saved' ? '已保存，不能再加入群星' : '加入群星上传队列' }}
              </button>
              <button
                  class="rounded-[1.35rem] bg-[#b45309] px-5 py-4 font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  :disabled="!isHeadlessDraftValid(selectedTrack) || isBusyTrack(selectedTrack) || selectedTrack.status === 'saved'"
                  @click="uploadAsHeadless(selectedTrack)"
              >
                {{ selectedTrack.status === 'saved' ? '已保存，不能重复上传' : '上传群星版本' }}
              </button>
              <p
                  v-if="!isHeadlessDraftValid(selectedTrack)"
                  class="rounded-xl bg-[#ffe1d8] px-3 py-2 text-sm font-bold text-[#8f2f17]"
              >
                群星模式至少需要填写歌名和歌手。
              </p>
            </div>
          </template>
        </template>
      </aside>
    </section>
  </main>
</template>
