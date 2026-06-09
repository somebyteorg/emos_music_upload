import {parseBlob} from 'music-metadata'

export interface LocalTrackMetadata {
    fileName: string
    relativePath: string
    folderArtist: string
    title: string
    artist: string
    album: string
    duration: number | null
    bitRate: number | null
    sampleRate: number | null
    parseError: string
}

const AUDIO_EXTENSIONS = new Set(['mp3', 'flac', 'm4a', 'aac', 'wav', 'ogg', 'opus', 'ape', 'wv'])

export function isAudioFile(file: File): boolean {
    const suffix = file.name.split('.').pop()?.toLowerCase() ?? ''

    return file.type.startsWith('audio/') || AUDIO_EXTENSIONS.has(suffix)
}

export async function readTrackMetadata(file: File): Promise<LocalTrackMetadata> {
    const relativePath = getRelativePath(file)
    const folderArtist = relativePath.includes('/') ? cleanArtistName(relativePath.split('/')[0] ?? '') : ''
    const fileGuess = guessFromFileName(file.name, folderArtist)

    try {
        const metadata = await parseBlob(file, {
            skipCovers: true,
        })
        const common = metadata.common
        const format = metadata.format
        const artist = cleanArtistName(common.artist || common.albumartist || common.artists?.join(' / ') || fileGuess.artist)
        const title = cleanSongName(common.title || fileGuess.title)

        return {
            fileName: file.name,
            relativePath,
            folderArtist,
            title,
            artist,
            album: common.album ?? '',
            duration: typeof format.duration === 'number' ? format.duration : null,
            bitRate: typeof format.bitrate === 'number' ? format.bitrate : null,
            sampleRate: typeof format.sampleRate === 'number' ? format.sampleRate : null,
            parseError: '',
        }
    } catch (error) {
        return {
            fileName: file.name,
            relativePath,
            folderArtist,
            title: fileGuess.title,
            artist: cleanArtistName(fileGuess.artist),
            album: '',
            duration: null,
            bitRate: null,
            sampleRate: null,
            parseError: error instanceof Error ? error.message : '元信息解析失败',
        }
    }
}

export function cleanSongName(value: string): string {
    return stripExtension(value)
        .replace(/^\s*\d{1,3}\s*[-_.、]\s*/, '')
        .replace(/\s+/g, ' ')
        .trim()
}

export function cleanArtistName(value: string): string {
    return value
        .replace(/\s*\[[^\]]*]\s*$/g, '')
        .replace(/\s*\([^)]*\)\s*$/g, '')
        .replace(/\s*（[^）]*）\s*$/g, '')
        .replace(/\s+/g, ' ')
        .trim()
}

function getRelativePath(file: File): string {
    return file.webkitRelativePath || file.name
}

function guessFromFileName(fileName: string, folderArtist: string): { artist: string; title: string } {
    const baseName = cleanSongName(fileName)
    const separatorMatch = baseName.match(/^(.+?)\s[-–—_]\s(.+)$/)

    if (separatorMatch) {
        return {
            artist: cleanArtistName(separatorMatch[1]),
            title: cleanSongName(separatorMatch[2]),
        }
    }

    if (folderArtist && baseName.toLowerCase().startsWith(`${folderArtist.toLowerCase()} - `)) {
        return {
            artist: folderArtist,
            title: cleanSongName(baseName.slice(folderArtist.length + 3)),
        }
    }

    return {
        artist: '',
        title: baseName,
    }
}

function stripExtension(value: string): string {
    return value.replace(/\.[a-z0-9]{2,5}$/i, '')
}
