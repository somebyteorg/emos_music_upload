import * as tus from 'tus-js-client'
import useSignStore from '@/stores/sign'

export const MAX_TUS_CHUNK_SIZE = 95 * 1024 * 1024

interface TusUploadOptions {
    endpoint: string
    file: File
    fileId: string
    onProgress: (percent: number, bytesUploaded: number, bytesTotal: number) => void
}

export interface TusUploadResult {
    file_id: string
    url: string
}

export async function uploadMusicFile(options: TusUploadOptions): Promise<TusUploadResult> {
    const sign = useSignStore()

    return new Promise<TusUploadResult>((resolve, reject) => {
        const upload = new tus.Upload(options.file, {
            endpoint: options.endpoint,
            chunkSize: MAX_TUS_CHUNK_SIZE,
            retryDelays: [0, 1000, 3000, 5000, 10000],
            removeFingerprintOnSuccess: true,
            metadata: {
                user_id: sign.user_id,
                file_id: options.fileId,
            },
            onProgress(bytesUploaded, bytesTotal) {
                const percent = bytesTotal > 0 ? (bytesUploaded / bytesTotal) * 100 : 0
                options.onProgress(percent, bytesUploaded, bytesTotal)
            },
            onSuccess(result) {
                const body = result.lastResponse.getBody()

                if (!body) {
                    resolve({
                        file_id: options.fileId,
                        url: '',
                    })
                    return
                }

                try {
                    const parsed = JSON.parse(body) as Partial<TusUploadResult>
                    resolve({
                        file_id: parsed.file_id || options.fileId,
                        url: parsed.url || '',
                    })
                } catch (error) {
                    reject(error)
                }
            },
            onError(error) {
                reject(error)
            },
        })

        upload
            .findPreviousUploads()
            .then((previousUploads) => {
                const previousUpload = previousUploads[0]

                if (previousUpload) {
                    upload.resumeFromPreviousUpload(previousUpload)
                }

                upload.start()
            })
            .catch(reject)
    })
}
