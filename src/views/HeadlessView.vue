<script setup lang="ts">
import {computed, onMounted, ref} from 'vue'
import {useRouter} from 'vue-router'
import {
  deleteSong,
  deleteSongMedia,
  getSongMediaPlayUrl,
  getUserProfile,
  listSongMedias,
  listSongs,
  moveSongMedia,
  searchSongs,
} from '@/services/emos'
import type {MusicMedia, MusicSong} from '@/types/music'
import type {UserProfile} from '@/types/music'
import useSignStore from '@/stores/sign'

const router = useRouter()
const sign = useSignStore()
const HEADLESS_PAGE_SIZE = 8
const TARGET_SEARCH_PAGE_SIZE = 5
const headlessSongs = ref<MusicSong[]>([])
const user = ref<UserProfile | null>(null)
const selectedSongId = ref<number | null>(null)
const medias = ref<MusicMedia[]>([])
const selectedMediaId = ref('')
const targetArtist = ref('')
const targetName = ref('')
const targetSongs = ref<MusicSong[]>([])
const playUrl = ref('')
const notice = ref('')
const isLoadingHeadless = ref(false)
const isLoadingMedias = ref(false)
const isSearching = ref(false)
const isMoving = ref(false)
const dragMediaId = ref('')
const headlessPage = ref(1)
const headlessTotal = ref(0)

type ModalAction = 'delete-song' | 'delete-media' | 'move-media' | null
const modalAction = ref<ModalAction>(null)
const modalTitle = ref('')
const modalMessage = ref('')
const modalConfirmText = ref('确认')
const modalData = ref<any>(null)

const selectedSong = computed(() => headlessSongs.value.find((song) => song.song_id === selectedSongId.value) ?? null)
const selectedMedia = computed(() => medias.value.find((media) => media.media_id === selectedMediaId.value) ?? medias.value[0] ?? null)
const hasMoreHeadlessSongs = computed(() => headlessSongs.value.length < headlessTotal.value)
const canDeleteSelectedSong = computed(() => sign.isAdmin || user.value?.roles.includes('admin') || user.value?.roles.includes('review') || false)

onMounted(async () => {
  await loadUser()
  await refreshHeadlessSongs()
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

async function refreshHeadlessSongs() {
  headlessPage.value = 1
  headlessSongs.value = []
  headlessTotal.value = 0
  selectedSongId.value = null
  medias.value = []
  selectedMediaId.value = ''
  playUrl.value = ''
  await loadHeadlessSongs(false)
}

async function loadHeadlessSongs(append = true) {
  isLoadingHeadless.value = true
  notice.value = append ? '正在加载更多群星歌曲' : '正在加载群星歌曲'

  try {
    const result = await listSongs({
      isHeadless: true,
      hasMedia: true,
      page: headlessPage.value,
      pageSize: HEADLESS_PAGE_SIZE,
    })
    headlessTotal.value = result.total
    headlessSongs.value = append ? [...headlessSongs.value, ...result.items] : result.items
    headlessPage.value += 1
    notice.value = `已加载 ${headlessSongs.value.length}/${result.total} 首群星歌曲`

    if (!selectedSongId.value) {
      const firstSong = result.items[0]

      if (firstSong) {
        selectedSongId.value = firstSong.song_id
        fillTargetSearchFromSong(firstSong)
        await loadMedias(firstSong.song_id)
      }
    }
  } catch (error) {
    notice.value = formatError(error)
  } finally {
    isLoadingHeadless.value = false
  }
}

async function selectSong(song: MusicSong) {
  selectedSongId.value = song.song_id
  selectedMediaId.value = ''
  playUrl.value = ''
  fillTargetSearchFromSong(song)
  await loadMedias(song.song_id)
}

async function loadMedias(songId: number) {
  isLoadingMedias.value = true

  try {
    medias.value = await listSongMedias(songId)
    selectedMediaId.value = medias.value[0]?.media_id ?? ''
    fillTargetSearchFromCurrentMedia()
  } catch (error) {
    notice.value = formatError(error)
  } finally {
    isLoadingMedias.value = false
  }
}

async function searchTargetSongs() {
  if (!targetArtist.value.trim() && !targetName.value.trim()) {
    notice.value = '请输入目标歌手或歌名'
    return
  }

  isSearching.value = true

  try {
    const result = await searchSongs({
      isHeadless: false,
      personNameArtist: targetArtist.value.trim(),
      name: targetName.value.trim(),
      pageSize: TARGET_SEARCH_PAGE_SIZE,
    })
    targetSongs.value = result.items
    notice.value = `找到 ${result.items.length} 首目标歌曲`
  } catch (error) {
    notice.value = formatError(error)
  } finally {
    isSearching.value = false
  }
}

async function playMedia(media: MusicMedia) {
  if (!selectedSong.value) return

  try {
    selectMedia(media)
    const result = await getSongMediaPlayUrl(selectedSong.value.song_id, media.media_id)
    playUrl.value = result.url
  } catch (error) {
    notice.value = formatError(error)
  }
}

async function moveSelectedMedia(targetSong: MusicSong, mediaId = selectedMedia.value?.media_id ?? '') {
  if (!mediaId) {
    notice.value = '请先选择一个媒体资源'
    return
  }

  modalAction.value = 'move-media'
  modalTitle.value = '移动媒体资源'
  modalMessage.value = `确定要将资源移动到「${targetSong.name}」吗？`
  modalConfirmText.value = '移动'
  modalData.value = { targetSong, mediaId }
}

async function confirmMoveMedia() {
  const { targetSong, mediaId } = modalData.value
  isMoving.value = true

  try {
    await moveSongMedia(targetSong.song_id, mediaId)
    notice.value = `已移动到「${targetSong.name}」`
    playUrl.value = ''

    if (selectedSong.value) {
      await loadMedias(selectedSong.value.song_id)
    }

    await refreshHeadlessSongs()
  } catch (error) {
    notice.value = formatError(error)
  } finally {
    isMoving.value = false
    dragMediaId.value = ''
    closeModal()
  }
}

async function removeMedia(media: MusicMedia) {
  if (!selectedSong.value) return
  if (!canDeleteMedia(media)) {
    notice.value = '只能删除自己上传的资源'
    return
  }

  modalAction.value = 'delete-media'
  modalTitle.value = '删除媒体资源'
  modalMessage.value = `确定要删除资源 ${media.media_id} 吗？此操作无法撤销。`
  modalConfirmText.value = '删除'
  modalData.value = media
}

async function confirmDeleteMedia() {
  const media = modalData.value
  if (!selectedSong.value) return

  try {
    await deleteSongMedia(selectedSong.value.song_id, media.media_id)
    notice.value = '资源已删除'
    await loadMedias(selectedSong.value.song_id)
  } catch (error) {
    notice.value = formatError(error)
  } finally {
    closeModal()
  }
}

async function removeHeadlessSong() {
  if (!selectedSong.value) return
  if (!canDeleteSelectedSong.value) {
    notice.value = '只有管理员可以删除群星歌曲'
    return
  }

  modalAction.value = 'delete-song'
  modalTitle.value = '删除群星歌曲'
  modalMessage.value = `确定要删除群星歌曲「${selectedSong.value.name}」吗？此操作会删除该歌曲及其所有资源，无法撤销。`
  modalConfirmText.value = '删除'
  modalData.value = selectedSong.value
}

async function confirmDeleteSong() {
  const song = modalData.value
  if (!song) return

  try {
    await deleteSong(song.song_id)
    notice.value = '群星歌曲已删除'
    await refreshHeadlessSongs()
  } catch (error) {
    notice.value = formatError(error)
  } finally {
    closeModal()
  }
}

function closeModal() {
  modalAction.value = null
  modalTitle.value = ''
  modalMessage.value = ''
  modalConfirmText.value = '确认'
  modalData.value = null
}

async function confirmModal() {
  if (modalAction.value === 'delete-song') {
    await confirmDeleteSong()
  } else if (modalAction.value === 'delete-media') {
    await confirmDeleteMedia()
  } else if (modalAction.value === 'move-media') {
    await confirmMoveMedia()
  }
}

function canDeleteMedia(media: MusicMedia): boolean {
  return canDeleteSelectedSong.value || media.user.user_id === sign.user_id || media.user.user_id === user.value?.user_id
}

function startDrag(media: MusicMedia) {
  selectMedia(media)
  dragMediaId.value = media.media_id
}

function dropOnTarget(song: MusicSong) {
  void moveSelectedMedia(song, dragMediaId.value)
}

function selectMedia(media: MusicMedia) {
  selectedMediaId.value = media.media_id

  if (!fillTargetSearchFromMedia(media) && selectedSong.value) {
    fillTargetSearchFromSong(selectedSong.value)
  }
}

function clearTargetArtist() {
  targetArtist.value = ''
  targetSongs.value = []
}

function clearTargetName() {
  targetName.value = ''
  targetSongs.value = []
}

function fillTargetSearchFromCurrentMedia() {
  const media = selectedMedia.value

  if (media && fillTargetSearchFromMedia(media)) {
    return
  }

  if (selectedSong.value) {
    fillTargetSearchFromSong(selectedSong.value)
  }
}

function fillTargetSearchFromMedia(media: MusicMedia): boolean {
  const artist = normalizeText(media.file_metadata?.artist)
  const title = normalizeText(media.file_metadata?.title)

  if (!artist && !title) {
    return false
  }

  targetArtist.value = artist
  targetName.value = title
  targetSongs.value = []

  return true
}

function fillTargetSearchFromSong(song: MusicSong) {
  const artist = firstArtistName(song)

  targetArtist.value = artist
  targetName.value = inferTargetName(song.name, artist)
  targetSongs.value = []
}

function firstArtistName(song: MusicSong): string {
  return song.person_artists.find((artist) => artist.name && artist.name !== '群星')?.name ?? ''
}

function inferTargetName(songName: string, artist: string): string {
  const trimmedName = songName.trim()

  if (!artist) {
    return trimmedName
  }

  const prefixes = [`${artist} - `, `${artist}-`, `${artist} — `, `${artist}_`]
  const matchedPrefix = prefixes.find((prefix) => trimmedName.startsWith(prefix))

  return matchedPrefix ? trimmedName.slice(matchedPrefix.length).trim() : trimmedName
}

function artistLine(song: MusicSong): string {
  return song.person_artists.map((artist) => artist.name).join(' / ') || '未知歌手'
}

function normalizeText(value: string | null | undefined): string {
  return value?.trim() ?? ''
}

function formatSize(value: number): string {
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败'
}
</script>

<template>
  <main class="min-h-screen overflow-x-hidden bg-[#f4efe5] text-[#17130c]">
    <div
        class="fixed inset-0 -z-10 bg-[radial-gradient(circle_at_10%_8%,rgba(180,83,9,0.2),transparent_30%),radial-gradient(circle_at_82%_16%,rgba(24,169,153,0.2),transparent_28%),linear-gradient(135deg,#f8f1e3,#eadfcd)]"></div>
    <div
        class="pointer-events-none fixed inset-0 -z-10 opacity-[0.16] [background-image:linear-gradient(rgba(23,19,12,.16)_1px,transparent_1px),linear-gradient(90deg,rgba(23,19,12,.14)_1px,transparent_1px)] [background-size:42px_42px]"></div>

    <header class="sticky top-0 z-20 border-b border-[#17130c]/10 bg-[#f4efe5]/85 backdrop-blur-xl">
      <div class="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <div>
          <p class="text-xs font-black uppercase tracking-[0.28em] text-[#b45309]">headless</p>
          <h1 class="text-2xl font-black tracking-[-0.05em] sm:text-3xl">群星关联</h1>
        </div>
        <nav
            class="flex items-center gap-2 rounded-full border border-[#17130c]/10 bg-white/45 p-1 shadow-sm shadow-[#17130c]/5">
          <RouterLink class="rounded-full px-4 py-2 text-sm font-bold text-[#5f5445] hover:bg-white/70" to="/upload">
            音乐上传
          </RouterLink>
          <RouterLink class="rounded-full bg-[#17130c] px-4 py-2 text-sm font-bold text-[#f8f1e3]" to="/headless">
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
        class="mx-auto grid max-w-[1680px] items-start gap-5 px-4 py-5 sm:px-5 lg:grid-cols-[0.9fr_0.98fr_1.18fr] xl:gap-6">
      <aside
          class="reveal-card rounded-[2rem] border border-[#17130c]/10 bg-white/78 p-5 shadow-xl shadow-[#17130c]/10 backdrop-blur lg:sticky lg:top-24">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h2 class="text-2xl font-black tracking-[-0.05em]">歌曲池</h2>
            <p class="mt-1 text-sm text-[#6d6252]">{{ notice || '选择一首群星歌曲查看资源' }}</p>
          </div>
          <button
              class="rounded-2xl bg-[#17130c] px-4 py-2 text-sm font-black text-[#f8f1e3] disabled:opacity-50"
              type="button"
              :disabled="isLoadingHeadless"
              @click="refreshHeadlessSongs"
          >
            刷新
          </button>
        </div>

        <div class="scroll-soft mt-5 max-h-[calc(100vh-190px)] space-y-3 overflow-auto pr-1">
          <button
              v-for="song in headlessSongs"
              :key="song.song_id"
              class="w-full rounded-[1.5rem] border p-4 text-left transition hover:-translate-y-0.5"
              :class="selectedSongId === song.song_id ? 'border-[#b45309] bg-[#fff0c2] shadow-md shadow-[#b45309]/10' : 'border-[#17130c]/10 bg-[#fffaf0] hover:border-[#17130c]/20'"
              type="button"
              @click="selectSong(song)"
          >
            <p class="text-lg font-black tracking-[-0.03em]">{{ song.name }}</p>
            <p class="mt-1 text-sm text-[#6d6252]">{{ artistLine(song) }}</p>
            <p class="mt-2 text-xs font-bold text-[#7a4a00]">资源 {{ song.count_medias ?? '-' }} · song_id
              {{ song.song_id }}</p>
          </button>
          <button
              v-if="hasMoreHeadlessSongs"
              class="w-full rounded-[1.5rem] border border-dashed border-[#17130c]/20 bg-white/60 p-4 text-center text-sm font-black text-[#40382d] disabled:opacity-50"
              type="button"
              :disabled="isLoadingHeadless"
              @click="() => loadHeadlessSongs()"
          >
            {{ isLoadingHeadless ? '加载中' : `加载更多（${headlessSongs.length}/${headlessTotal}）` }}
          </button>
        </div>
      </aside>

      <section
          class="reveal-card rounded-[2rem] border border-[#17130c]/10 bg-white/78 p-5 shadow-xl shadow-[#17130c]/10 backdrop-blur">
        <div class="rounded-[1.75rem] bg-[#17130c] p-5 text-[#f8f1e3] shadow-lg shadow-[#17130c]/10">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-xs font-black uppercase tracking-[0.24em] text-[#8ff1e4]">media</p>
              <h2 class="mt-2 break-words text-2xl font-black tracking-[-0.05em]">{{
                  selectedSong?.name || '未选择歌曲'
                }}</h2>
            </div>
            <button
                class="shrink-0 rounded-2xl border border-[#f8f1e3]/20 px-4 py-2 text-sm font-black text-[#ffe1d8] hover:bg-white/10 disabled:opacity-50"
                type="button"
                :disabled="!selectedSong || !canDeleteSelectedSong"
                @click="removeHeadlessSong"
            >
              {{ canDeleteSelectedSong ? '删除歌曲' : '不可删除' }}
            </button>
          </div>
        </div>

        <div v-if="isLoadingMedias"
             class="mt-5 rounded-2xl bg-[#fff0c2] p-4 text-sm font-bold text-[#7a4a00] ring-1 ring-[#b45309]/10">
          正在加载资源
        </div>

        <div v-else class="scroll-soft mt-5 max-h-[calc(100vh-230px)] space-y-3 overflow-auto pr-1">
          <div
              v-for="media in medias"
              :key="media.media_id"
              class="relative overflow-hidden rounded-[1.5rem] border p-4 pl-5 transition hover:-translate-y-0.5"
              :class="selectedMedia?.media_id === media.media_id ? 'border-[#18a999] bg-[#ecfffb] shadow-lg shadow-[#18a999]/10' : 'border-[#17130c]/10 bg-[#fffaf0] hover:border-[#17130c]/20'"
              draggable="true"
              @click="selectMedia(media)"
              @dragstart="startDrag(media)"
          >
            <div class="absolute inset-y-4 left-0 w-1 rounded-r-full"
                 :class="selectedMedia?.media_id === media.media_id ? 'bg-[#18a999]' : 'bg-[#a79a86]'"></div>
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="break-words font-black">{{ media.name }}</p>
                <p class="mt-1 text-sm text-[#6d6252]">
                  {{ media.file_suffix }} · {{ formatSize(media.file_size) }} · {{ media.user.username }}
                </p>
                <div v-if="media.file_metadata"
                   class="mt-2 rounded-2xl bg-white/70 px-3 py-2 text-sm font-bold text-[#0f766e]">
                  <p>歌手: {{ media.file_metadata.artist || '' }}</p>
                  <p>歌名: {{ media.file_metadata.title || '' }}</p>
                  <p>专辑: {{ media.file_metadata.album || '' }}</p>
                </div>
              </div>
              <span class="shrink-0 rounded-full bg-[#17130c] px-2 py-1 text-xs font-black text-[#f8f1e3]">
                {{ media.media_id }}
              </span>
            </div>
            <div class="mt-4 flex gap-2">
              <button
                  class="rounded-xl bg-[#18a999] px-3 py-2 text-sm font-black text-[#071411] shadow-md shadow-[#18a999]/15"
                  type="button" @click.stop="playMedia(media)">
                试听
              </button>
              <button
                  class="rounded-xl bg-[#ffe1d8] px-3 py-2 text-sm font-black text-[#8f2f17] hover:bg-[#ffd4c7] disabled:opacity-45"
                  type="button"
                  :disabled="!canDeleteMedia(media)"
                  @click.stop="removeMedia(media)"
              >
                {{ canDeleteMedia(media) ? '删除' : '非本人' }}
              </button>
            </div>
          </div>

          <p v-if="!medias.length"
             class="rounded-[1.5rem] border border-dashed border-[#17130c]/15 bg-[#fffaf0] p-6 text-center text-[#6d6252]">
            当前群星歌曲没有媒体资源。
          </p>
        </div>

        <audio v-if="playUrl" class="mt-5 w-full" :src="playUrl" controls></audio>
      </section>

      <aside
          class="reveal-card scroll-soft rounded-[2rem] border border-[#17130c]/10 bg-white/78 p-5 shadow-xl shadow-[#17130c]/10 backdrop-blur lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-auto">
        <div class="rounded-[1.75rem] bg-[#fffaf0] p-5 ring-1 ring-[#17130c]/5">
          <h2 class="text-2xl font-black tracking-[-0.05em]">目标歌曲</h2>
          <p class="mt-1 text-sm leading-6 text-[#6d6252]">
            搜索正确歌曲，把左侧媒体拖到目标歌曲卡片，或选中媒体后点击移动。
          </p>
        </div>

        <div class="mt-4 grid gap-3 rounded-[1.5rem] bg-[#fffaf0] p-4 ring-1 ring-[#17130c]/5">
          <label class="block text-sm font-black text-[#40382d]">
            目标歌手
            <span class="relative mt-2 block">
              <input
                  v-model="targetArtist"
                  class="field-input"
                  placeholder="例如：许嵩"
                  type="text"
                  @keyup.enter="searchTargetSongs"
              >
              <button
                  v-if="targetArtist"
                  class="clear-button"
                  type="button"
                  aria-label="清空目标歌手"
                  @click="clearTargetArtist"
              >
                <span aria-hidden="true">x</span>
              </button>
            </span>
          </label>
          <label class="block text-sm font-black text-[#40382d]">
            歌名关键字
            <span class="relative mt-2 block">
              <input
                  v-model="targetName"
                  class="field-input"
                  placeholder="可留空，仅按歌手搜索"
                  type="text"
                  @keyup.enter="searchTargetSongs"
              >
              <button
                  v-if="targetName"
                  class="clear-button"
                  type="button"
                  aria-label="清空歌名关键字"
                  @click="clearTargetName"
              >
                <span aria-hidden="true">x</span>
              </button>
            </span>
          </label>
          <button
              class="rounded-2xl bg-[#17130c] px-4 py-3 font-black text-[#f8f1e3] shadow-lg shadow-[#17130c]/15 disabled:opacity-50"
              type="button"
              :disabled="isSearching"
              @click="searchTargetSongs"
          >
            {{ isSearching ? '搜索中' : '搜索目标歌曲' }}
          </button>
        </div>

        <div class="mt-5 max-h-[calc(100vh-430px)] space-y-3 overflow-auto pr-1 lg:max-h-none">
          <div
              v-for="song in targetSongs"
              :key="song.song_id"
              class="rounded-[1.5rem] border border-[#17130c]/10 bg-[#fffaf0] p-4 transition hover:-translate-y-0.5 hover:border-[#18a999] hover:shadow-md hover:shadow-[#18a999]/10"
              @dragover.prevent
              @drop.prevent="dropOnTarget(song)"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="break-words text-lg font-black tracking-[-0.03em]">{{ song.name }}</p>
                <p class="mt-1 text-sm text-[#6d6252]">{{ artistLine(song) }}</p>
                <p class="mt-2 text-xs text-[#6d6252]">song_id {{ song.song_id }} · 媒体 {{
                    song.count_medias ?? '-'
                  }}</p>
              </div>
              <button
                  class="shrink-0 rounded-xl bg-[#18a999] px-3 py-2 text-sm font-black text-[#071411] shadow-md shadow-[#18a999]/15 disabled:opacity-50"
                  type="button"
                  :disabled="isMoving || !selectedMedia"
                  @click="moveSelectedMedia(song)"
              >
                移动
              </button>
            </div>
          </div>

          <p v-if="!targetSongs.length"
             class="rounded-[1.5rem] border border-dashed border-[#17130c]/15 bg-[#fffaf0] p-6 text-center text-[#6d6252]">
            暂无目标歌曲结果。
          </p>
        </div>
      </aside>
    </section>

    <!-- Modal -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div
            v-if="modalAction"
            class="fixed inset-0 z-50 flex items-center justify-center bg-[#17130c]/60 px-4 backdrop-blur-sm"
            @click.self="closeModal"
        >
          <div
              class="w-full max-w-md transform rounded-[2rem] border border-[#17130c]/10 bg-white p-6 shadow-2xl transition-all"
              role="dialog"
              aria-modal="true"
          >
            <div class="flex items-start justify-between gap-4">
              <div>
                <h3 class="text-2xl font-black tracking-[-0.05em]">{{ modalTitle }}</h3>
                <p class="mt-3 leading-7 text-[#6d6252]">{{ modalMessage }}</p>
              </div>
              <button
                  class="grid h-10 w-10 shrink-0 place-items-center rounded-full text-xl font-black text-[#6d6252] hover:bg-[#f1e7d7]"
                  type="button"
                  aria-label="关闭"
                  @click="closeModal"
              >
                ×
              </button>
            </div>

            <div class="mt-6 flex gap-3">
              <button
                  class="flex-1 rounded-[1.35rem] border border-[#17130c]/15 px-5 py-3 font-black text-[#40382d] hover:bg-[#f1e7d7]"
                  type="button"
                  @click="closeModal"
              >
                取消
              </button>
              <button
                  class="flex-1 rounded-[1.35rem] px-5 py-3 font-black text-white shadow-lg disabled:opacity-50"
                  :class="modalAction === 'move-media' ? 'bg-[#18a999] shadow-[#18a999]/20' : 'bg-[#8f2f17] shadow-[#8f2f17]/20'"
                  type="button"
                  :disabled="isMoving"
                  @click="confirmModal"
              >
                {{ modalConfirmText }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

  </main>
</template>
