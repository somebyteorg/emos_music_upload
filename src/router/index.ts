import {createRouter, createWebHashHistory} from 'vue-router'
import useSignStore from '@/stores/sign'

const router = createRouter({
    history: createWebHashHistory('/upload/'),
    routes: [
        {
            path: '/',
            redirect: '/upload',
        },
        {
            path: '/login',
            name: 'login',
            component: () => import('@/views/LoginView.vue'),
            meta: {
                public: true,
            },
        },
        {
            path: '/upload',
            name: 'upload',
            component: () => import('@/views/UploadView.vue'),
        },
        {
            path: '/headless',
            name: 'headless',
            component: () => import('@/views/HeadlessView.vue'),
        },
        {
            path: '/:pathMatch(.*)*',
            redirect: '/',
        },
    ],
})

router.beforeEach((to) => {
    const sign = useSignStore()
    const callbackSession = readExternalCallbackSession()

    if (callbackSession) {
        sign.setSession(callbackSession)
        clearExternalCallbackQuery()

        return {
            name: 'upload',
            replace: true,
        }
    }

    if (!to.meta.public && !sign.isSignedIn) {
        return {
            name: 'login',
            query: {
                redirect: to.fullPath,
            },
        }
    }

    return true
})

export default router

function readExternalCallbackSession(): { userId: string; username: string; avatar: string | null; token: string } | null {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')?.trim()

    if (!token) {
        return null
    }

    return {
        userId: params.get('user_id') ?? '',
        username: params.get('username') ?? '',
        avatar: params.get('avatar'),
        token,
    }
}

function clearExternalCallbackQuery() {
    const cleanUrl = `${window.location.pathname}${window.location.hash || ''}`
    window.history.replaceState(window.history.state, '', cleanUrl)
}
