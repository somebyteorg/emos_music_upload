import api from '@/utils/ky'
import type {
    CarrotResponse,
    MusicMedia,
    MusicSong,
    PageResult,
    SaveUploadResponse,
    UploadTokenResponse,
    UserProfile,
} from '@/types/music'

type MaybeBoolean = boolean | '' | undefined

interface SongQuery {
    name?: string
    hasMedia?: MaybeBoolean
    personIdArtist?: string | number
    personNameArtist?: string
    isHeadless?: MaybeBoolean
    page?: number
    pageSize?: number
}

interface UploadTokenPayload {
    file: File
    fileStorage?: string
}

interface SaveHeadlessPayload {
    name_song: string
    name_person: string
    description: string
    release_date: string | null
    is_adult: boolean
    image_poster_url: null
    file_id: string
}

function boolParam(value: MaybeBoolean): string {
    return value === true ? '1' : '0'
}

function commonSongParams(query: SongQuery) {
    return {
        name: query.name ?? '',
        has_media: query.hasMedia !== undefined ? boolParam(query.hasMedia) : '',
        person_id_artist: query.personIdArtist ? String(query.personIdArtist) : '',
        person_name_artist: query.personNameArtist ?? '',
        is_headless: boolParam(query.isHeadless),
        page: String(query.page ?? 1),
        page_size: String(query.pageSize ?? 100),
    }
}

export async function getUserProfile(): Promise<UserProfile> {
    return api.get('api/user').json<UserProfile>()
}

export async function searchSongs(query: SongQuery): Promise<PageResult<MusicSong>> {
    return api
        .get('api/music/song/search', {
            searchParams: commonSongParams(query),
        })
        .json<PageResult<MusicSong>>()
}

export async function listSongs(query: SongQuery & {
    songId?: string | number;
    albumId?: string | number
}): Promise<PageResult<MusicSong>> {
    return api
        .get('api/music/song/list', {
            searchParams: {
                song_id: query.songId ? String(query.songId) : '',
                album_id: query.albumId ? String(query.albumId) : '',
                is_favorite: '',
                is_rating: '',
                ...commonSongParams(query),
            },
        })
        .json<PageResult<MusicSong>>()
}

export async function getUploadToken(payload: UploadTokenPayload): Promise<UploadTokenResponse> {
    return api
        .post('api/upload/getUploadToken', {
            json: {
                type: 'music',
                file_type: payload.file.type || guessFileType(payload.file.name),
                file_name: payload.file.name,
                file_size: payload.file.size,
                file_storage: payload.fileStorage ?? 'default',
            },
        })
        .json<UploadTokenResponse>()
}

export async function saveMusicUpload(musicSongId: number, fileId: string): Promise<SaveUploadResponse> {
    return api
        .post('api/upload/music/save', {
            json: {
                music_song_id: musicSongId,
                file_id: fileId,
            },
        })
        .json<SaveUploadResponse>()
}

export async function saveHeadlessMusicUpload(payload: SaveHeadlessPayload): Promise<SaveUploadResponse> {
    return api
        .post('api/upload/music/saveHeadless', {
            json: payload,
        })
        .json<SaveUploadResponse>()
}

export async function listSongMedias(songId: number): Promise<MusicMedia[]> {
    return api.get(`api/music/song/${songId}/media/list`).json<MusicMedia[]>()
}

export async function getSongMediaPlayUrl(songId: number, mediaId: string): Promise<{ url: string }> {
    return api
        .get(`api/music/song/${songId}/media/playUrl`, {
            searchParams: {
                media_id: mediaId,
            },
        })
        .json<{ url: string }>()
}

export async function moveSongMedia(targetSongId: number, mediaId: string): Promise<CarrotResponse> {
    return api
        .put(`api/music/song/${targetSongId}/media/move`, {
            searchParams: {
                media_id: mediaId,
            },
        })
        .json<CarrotResponse>()
}

export async function deleteSongMedia(songId: number, mediaId: string): Promise<CarrotResponse> {
    return api
        .delete(`api/music/song/${songId}/media/delete`, {
            searchParams: {
                media_id: mediaId,
            },
        })
        .json<CarrotResponse>()
}

export async function deleteSong(songId: number): Promise<CarrotResponse> {
    return api.delete(`api/music/song/${songId}/delete`).json<CarrotResponse>()
}

function guessFileType(fileName: string): string {
    const suffix = fileName.split('.').pop()?.toLowerCase()

    if (suffix === 'mp3') return 'audio/mpeg'
    if (suffix === 'flac') return 'audio/flac'
    if (suffix === 'm4a') return 'audio/mp4'
    if (suffix === 'wav') return 'audio/wav'
    if (suffix === 'ogg') return 'audio/ogg'

    return 'application/octet-stream'
}
