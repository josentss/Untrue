import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fs from 'node:fs';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg';
import { ffmpeg as ffmpegPath } from '../core/config.js';

ffmpeg.setFfmpegPath(ffmpegPath);

export class PinterestDownloader {
    constructor() {
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Cache-Control': 'max-age=0'
        };
    }

    async expandShortUrl(url) {
        if (!url.includes('pin.it/')) {
            return url;
        }

        try {
            const response = await axios.get(url, {
                headers: this.headers,
                timeout: 10000,
                maxRedirects: 0,
                validateStatus: null
            });

            if (response.status >= 300 && response.status < 400 && response.headers.location) {
                console.log('URL expandida:', response.headers.location);
                return response.headers.location;
            }
        } catch (error) {
            console.log('No se pudo expandir URL corta, usando original');
        }

        return url;
    }

    async processVideo(inputPath, outputPath) {
        return new Promise((resolve, reject) => {
            console.log('Procesando video...');

            ffmpeg(inputPath)
                .outputOptions([
                    '-c:v', 'libx264',
                    '-c:a', 'aac',
                    '-movflags', '+faststart',
                    '-preset', 'fast',
                    '-crf', '23',
                    '-r', '30',
                    '-pix_fmt', 'yuv420p'
                ])
                .output(outputPath)
                .on('start', () => {
                    console.log('Iniciando procesamiento de video...');
                })
                .on('progress', (progress) => {
                    if (progress.percent) {
                        console.log(`Progreso: ${Math.round(progress.percent)}%`);
                    }
                })
                .on('end', () => {
                    console.log('Video procesado correctamente');
                    resolve(outputPath);
                })
                .on('error', (error) => {
                    console.error('Error procesando video:', error.message);
                    reject(error);
                })
                .run();
        });
    }

    async extractPinData(url) {
        try {
            console.log('Extrayendo datos del pin...');

            const expandedUrl = await this.expandShortUrl(url);
            const response = await axios.get(expandedUrl, {
                headers: this.headers,
                timeout: 15000
            });

            const html = response.data;
            const jsonMatch = html.match(/<script id="__PWS_DATA__" type="application\/json">(.*?)<\/script>/);

            if (jsonMatch) {
                try {
                    const jsonData = JSON.parse(jsonMatch[1]);
                    console.log('Datos encontrados via PWS_DATA');
                    return this.parsePWSData(jsonData);
                } catch (e) {
                    console.log('Error parseando PWS_DATA');
                }
            }

            const metaData = this.extractFromMetaTags(html);
            if (metaData.mediaUrl) {
                console.log('Datos encontrados via meta tags');
                return metaData;
            }

            const directUrls = this.extractDirectUrls(html);
            if (directUrls.mediaUrl) {
                console.log('URLs encontradas directamente');
                return directUrls;
            }

            throw new Error('No se pudieron extraer datos del pin');
        } catch (error) {
            console.error('Error extrayendo datos:', error.message);
            throw error;
        }
    }

    parsePWSData(jsonData) {
        try {
            const findMediaUrl = (obj) => {
                if (typeof obj === 'object' && obj !== null) {
                    if (obj.images) {
                        const images = obj.images;
                        const qualityOrder = ['orig', 'origin', 'original', '736x', '564x'];
                        for (const quality of qualityOrder) {
                            if (images[quality] && images[quality].url) {
                                return {
                                    mediaUrl: images[quality].url,
                                    isVideo: false,
                                    title: obj.title || obj.grid_title || 'Pin de Pinterest',
                                    description: obj.description || obj.grid_description || 'Sin descripción',
                                    author: obj.pinner?.username || obj.pinner?.full_name || 'Usuario de Pinterest'
                                };
                            }
                        }
                    }

                    if (obj.videos) {
                        const videoUrl = obj.videos.video_list?.V_720P?.url ||
                                       obj.videos.video_list?.V_480P?.url ||
                                       Object.values(obj.videos).find(url => url && url.includes('.mp4'));
                        if (videoUrl) {
                            return {
                                mediaUrl: videoUrl,
                                isVideo: true,
                                title: obj.title || 'Video de Pinterest',
                                description: obj.description || 'Sin descripción',
                                author: obj.pinner?.username || 'Usuario de Pinterest'
                            };
                        }
                    }

                    for (const key in obj) {
                        const result = findMediaUrl(obj[key]);
                        if (result) return result;
                    }
                }
                return null;
            };

            const result = findMediaUrl(jsonData);
            if (result) return result;

            throw new Error('No se encontraron medios en PWS_DATA');
        } catch (error) {
            console.error('Error parseando PWS_DATA:', error.message);
            throw error;
        }
    }

    extractFromMetaTags(html) {
        const metaData = {
            mediaUrl: null,
            isVideo: false,
            title: 'Pin de Pinterest',
            description: 'Sin descripción disponible',
            author: 'Usuario de Pinterest'
        };

        const ogImageMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
        if (ogImageMatch) metaData.mediaUrl = ogImageMatch[1];

        const ogVideoMatch = html.match(/<meta property="og:video" content="([^"]+)"/);
        if (ogVideoMatch) {
            metaData.mediaUrl = ogVideoMatch[1];
            metaData.isVideo = true;
        }

        const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
        if (titleMatch) metaData.title = titleMatch[1];

        const descMatch = html.match(/<meta property="og:description" content="([^"]+)"/);
        if (descMatch) metaData.description = descMatch[1];

        return metaData;
    }

    extractDirectUrls(html) {
        const result = {
            mediaUrl: null,
            isVideo: false,
            title: 'Pin de Pinterest',
            description: 'Sin descripción disponible',
            author: 'Usuario de Pinterest'
        };

        const imageUrlMatch = html.match(/"url":"(https:\/\/[^"]+\.(jpg|jpeg|png|webp)[^"]*)"/);
        if (imageUrlMatch) result.mediaUrl = imageUrlMatch[1];

        const videoUrlMatch = html.match(/"url":"(https:\/\/[^"]+\.mp4[^"]*)"/);
        if (videoUrlMatch) {
            result.mediaUrl = videoUrlMatch[1];
            result.isVideo = true;
        }

        if (!result.mediaUrl) {
            const srcMatch = html.match(/<img[^>]+src="(https:\/\/[^"]+\.(jpg|jpeg|png|webp)[^"]*)"/);
            if (srcMatch) result.mediaUrl = srcMatch[1];
        }

        const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
        if (titleMatch) result.title = titleMatch[1];

        const descMatch = html.match(/<meta property="og:description" content="([^"]+)"/);
        if (descMatch) result.description = descMatch[1];

        return result;
    }

    async downloadMediaFile(mediaUrl, filePath) {
        try {
            console.log(`Descargando desde: ${mediaUrl}`);

            const response = await axios({
                method: 'GET',
                url: mediaUrl,
                responseType: 'stream',
                timeout: 60000,
                headers: {
                    ...this.headers,
                    'Referer': 'https://www.pinterest.com/',
                    'Accept': 'video/mp4,video/webm,video/ogg,image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
                }
            });

            return new Promise((resolve, reject) => {
                const writer = fs.createWriteStream(filePath);
                let downloadedBytes = 0;

                response.data.on('data', (chunk) => {
                    downloadedBytes += chunk.length;
                    if (downloadedBytes % 1000000 === 0) {
                        console.log(`Descargados: ${(downloadedBytes / 1000000).toFixed(1)}MB`);
                    }
                });

                response.data.pipe(writer);

                writer.on('finish', () => {
                    console.log(`Descarga completada: ${downloadedBytes} bytes`);
                    resolve(filePath);
                });

                writer.on('error', reject);
                response.data.on('error', reject);
            });
        } catch (error) {
            console.error('Error descargando archivo:', error.message);
            throw error;
        }
    }

    async downloadPinterestMedia(url) {
        let tempFilePath = null;
        let processedFilePath = null;

        try {
            console.log(`Descargando pin: ${url}`);
            const pinData = await this.extractPinData(url);

            if (!pinData.mediaUrl) {
                throw new Error('No se pudo obtener URL de descarga');
            }

            const timestamp = Date.now();
            const fileExtension = pinData.isVideo ? 'mp4' : 'jpg';
            tempFilePath = join(tmpdir(), `pinterest-raw-${timestamp}.${fileExtension}`);

            if (pinData.isVideo) {
                processedFilePath = join(tmpdir(), `pinterest-processed-${timestamp}.mp4`);
            }

            await this.downloadMediaFile(pinData.mediaUrl, tempFilePath);

            const stats = fs.statSync(tempFilePath);
            if (stats.size === 0) {
                throw new Error('Archivo descargado está vacío');
            }

            let finalFilePath = tempFilePath;

            if (pinData.isVideo && processedFilePath) {
                console.log('Procesando video...');
                try {
                    finalFilePath = await this.processVideo(tempFilePath, processedFilePath);
                    this.cleanUpFile(tempFilePath);
                    tempFilePath = null;
                } catch (processError) {
                    console.warn('Usando video original');
                    if (processedFilePath && fs.existsSync(processedFilePath)) {
                        this.cleanUpFile(processedFilePath);
                    }
                    processedFilePath = null;
                }
            }

            return {
                filePath: finalFilePath,
                videoInfo: {
                    title: pinData.title || 'Pin de Pinterest',
                    author: pinData.author || 'Usuario de Pinterest',
                    description: pinData.description || 'Sin descripción disponible',
                    uploadDate: new Date().toLocaleDateString('es-ES')
                },
                isImage: !pinData.isVideo,
                isVideo: pinData.isVideo,
                fileExtension: fileExtension
            };

        } catch (error) {
            console.error('Error:', error.message);

            if (tempFilePath && fs.existsSync(tempFilePath)) {
                this.cleanUpFile(tempFilePath);
            }
            if (processedFilePath && fs.existsSync(processedFilePath)) {
                this.cleanUpFile(processedFilePath);
            }

            throw new Error(`No se pudo descargar el pin: ${error.message}`);
        }
    }

    cleanUpFile(filePath) {
        try {
            if (filePath && fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`Archivo eliminado: ${filePath}`);
            }
        } catch (e) {
            console.warn(`Error limpiando archivo: ${e.message}`);
        }
    }
}

export const pinterestDownloader = new PinterestDownloader();

export async function downloadPinterestMedia(url) {
    return await pinterestDownloader.downloadPinterestMedia(url);
}

export function cleanUpPinterestFile(filePath) {
    return pinterestDownloader.cleanUpFile(filePath);
}
