import {computed, ref} from 'vue'
import {defineStore} from 'pinia'

export const useSignStore = defineStore(
    'sign',
    () => {
        const user_id = ref('')
        const username = ref('')
        const avatar = ref<string | null>(null)
        const user_token = ref('')
        const roles = ref<string[]>([])

        const isSignedIn = computed(() => Boolean(user_token.value))
        const isAdmin = computed(() => roles.value.includes('admin') || roles.value.includes('review'))

        function setSession(payload: { userId?: string; username?: string; avatar?: string | null; roles?: string[]; token: string }) {
            user_id.value = payload.userId ?? ''
            username.value = payload.username ?? ''
            avatar.value = normalizeAvatar(payload.avatar)
            roles.value = payload.roles ?? []
            user_token.value = payload.token
        }

        function setProfile(payload: { userId?: string; username?: string; avatar?: string | null; roles?: string[] }) {
            user_id.value = payload.userId ?? user_id.value
            username.value = payload.username ?? username.value
            avatar.value = payload.avatar === undefined ? avatar.value : normalizeAvatar(payload.avatar)
            roles.value = payload.roles ?? roles.value
        }

        function setToken(token: string) {
            user_token.value = token
        }

        async function signOut() {
            user_id.value = ''
            username.value = ''
            avatar.value = null
            user_token.value = ''
            roles.value = []
        }

        function normalizeAvatar(value: string | null | undefined): string | null {
            const normalized = value?.trim()

            if (!normalized || normalized === 'null' || normalized === 'undefined') {
                return null
            }

            return normalized
        }

        return {
            user_id,
            username,
            avatar,
            user_token,
            roles,
            isSignedIn,
            isAdmin,
            setSession,
            setProfile,
            setToken,
            signOut,
        }
    },
    {
        persist: true,
    },
)

export default useSignStore
