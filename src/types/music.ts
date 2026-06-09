export interface PageResult<T> {
    page: number
    page_size: number
    total: number
    items: T[]
}

export interface UserProfile {
    user_id: string
    username: string
    avatar: string | null
    is_can_upload: boolean
    size_upload: number
    carrot: number
    roles: string[]
}

export interface PersonArtist {
    person_id: number | null
    name: string
    original_name: string | null
    image_profile_url?: string | null
    gender?: null
    is_virtual?: boolean | number | null
    is_adult?: boolean | null
}

export interface MusicAlbum {
    album_id?: number
    todb_music_album_id?: number
    name: string
}

export interface MusicSong {
    song_id: number
    todb_music_song_id?: number
    todb_music_music_id?: number | null
    name: string
    image_poster_url: string | null
    description?: string | null
    tagline: string | null
    release_date?: string | null
    duration?: number
    has_media: boolean
    is_adult: boolean | null
    person_artists: PersonArtist[]
    albums?: MusicAlbum[]
    count_medias?: number
    count_lryics?: number
}

export interface MusicMedia {
    media_id: string
    file_suffix: string
    file_type: string
    file_size: number
    file_hash?: string | null
    file_duration?: number | null
    file_second?: number | null
    file_metadata?: {
        album?: string | null
        title?: string | null
        artist?: string | null
        year?: number | string | null
    } | null
    file_quality: string | null
    meta_rate_bit: number | null
    meta_rate_sampling: number | null
    meta_bit_depth: number | null
    meta_channel: number | string | null
    path_type: string
    is_primary: boolean
    name: string
    created_at: string
    user: {
        user_id: string
        username: string
        avatar: string | null
    }
}

export interface UploadTokenResponse {
    type: string
    file_id: string
    data: {
        upload_url: string
    }
}

export interface SaveUploadResponse {
    carrot: number
    media_id: string
}

export interface CarrotResponse {
    carrot: number
}
