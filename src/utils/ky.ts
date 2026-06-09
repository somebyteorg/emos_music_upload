import ky from 'ky'
import signStore from '@/stores/sign'

export {ky}

const instance = ky.create({
    prefixUrl: 'https://emos.best',
    timeout: 1000 * 30,
    retry: 0,
    hooks: {
        beforeRequest: [
            (request) => {
                let token = signStore().user_token

                if (token) {
                    request.headers.set('Authorization', `Bearer ${token}`)
                }
            },
        ],
        afterResponse: [
            async (_request, _options, response) => {
                if (response.status == 401) {
                    await signStore().signOut()
                }
            },
        ],
    },
})

export default instance
