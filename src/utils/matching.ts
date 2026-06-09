import type {MusicSong} from '@/types/music'
import type {LocalTrackMetadata} from '@/utils/metadata'

export interface SongMatch {
    song: MusicSong
    score: number
    reason: string
}

export type MatchStatus = 'matched' | 'confirm' | 'unmatched'

export interface MatchResult {
    status: MatchStatus
    best: SongMatch | null
    alternatives: SongMatch[]
}

const NOISE_WORDS = [
    'remix',
    'live',
    'ver',
    'version',
    'edit',
    'mix',
    '伴奏',
    '翻唱',
    '现场',
    '重制',
    '新版',
    '纯音乐',
    '钢琴版',
    '试听',
]

export function matchTrackToSongs(track: LocalTrackMetadata, songs: MusicSong[]): MatchResult {
    const matches = songs
        .map((song) => scoreSong(track, song))
        .filter((match) => match.score >= 0.45)
        .sort((a, b) => b.score - a.score)

    const best = matches[0] ?? null
    const second = matches[1] ?? null

    if (!best) {
        return {
            status: 'unmatched',
            best: null,
            alternatives: [],
        }
    }

    if (best.score >= 0.9 && (!second || best.score - second.score >= 0.06)) {
        return {
            status: 'matched',
            best,
            alternatives: matches.slice(0, 5),
        }
    }

    return {
        status: 'confirm',
        best,
        alternatives: matches.slice(0, 5),
    }
}

export function normalizeSongTitle(value: string): string {
    return value
        .normalize('NFKC')
        .toLowerCase()
        .replace(/（[^）]*）/g, ' ')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\[[^\]]*]/g, ' ')
        .replace(/【[^】]*】/g, ' ')
        .replace(/[《》"'“”‘’]/g, ' ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function normalizeLoose(value: string): string {
    let normalized = normalizeSongTitle(value)

    for (const word of NOISE_WORDS) {
        normalized = normalized.replace(new RegExp(`\\b${escapeRegExp(word)}\\b`, 'gi'), ' ')
    }

    return normalized.replace(/\s+/g, ' ').trim()
}

function scoreSong(track: LocalTrackMetadata, song: MusicSong): SongMatch {
    const localFull = normalizeSongTitle(track.title)
    const localLoose = normalizeLoose(track.title)
    const remoteFull = normalizeSongTitle(song.name)
    const remoteLoose = normalizeLoose(song.name)
    let score = similarity(localLoose || localFull, remoteLoose || remoteFull)
    let reason = '模糊匹配'

    if (localFull && remoteFull && localFull === remoteFull) {
        score = 1
        reason = '歌名完全一致'
    } else if (localLoose && remoteLoose && localLoose === remoteLoose) {
        score = 0.96
        reason = '去除括号/版本字段后一致'
    } else if (localLoose && remoteLoose && (localLoose.includes(remoteLoose) || remoteLoose.includes(localLoose))) {
        score = Math.max(score, 0.86)
        reason = '标题互相包含'
    }

    if (track.duration && song.duration) {
        const diff = Math.abs(track.duration - song.duration)

        if (diff <= 3) {
            score = Math.min(1, score + 0.06)
            reason += '，时长接近'
        } else if (diff >= 20) {
            score = Math.max(0, score - 0.08)
            reason += '，时长差异较大'
        }
    }

    return {
        song,
        score: Number(score.toFixed(3)),
        reason,
    }
}

function similarity(a: string, b: string): number {
    if (!a || !b) return 0
    if (a === b) return 1

    const distance = levenshteinDistance(a, b)
    const maxLength = Math.max(a.length, b.length)

    return maxLength === 0 ? 0 : 1 - distance / maxLength
}

function levenshteinDistance(a: string, b: string): number {
    const previous = Array.from({length: b.length + 1}, (_, index) => index)
    const current = new Array<number>(b.length + 1)

    for (let i = 1; i <= a.length; i += 1) {
        current[0] = i

        for (let j = 1; j <= b.length; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1
            current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost)
        }

        for (let j = 0; j <= b.length; j += 1) {
            previous[j] = current[j]
        }
    }

    return previous[b.length]
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
