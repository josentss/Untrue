# Untrue 2.0

Bot de WhatsApp no oficial con Baileys 7.0.0-rc14, Node.js 22 y Docker. Una sola instancia, sin dominio público obligatorio. Mantiene comandos de uso cotidiano; no publica estados ni procesa contenido de visualización única.

## Comandos

| Comando | Función |
|---|---|
| #menu, #help, #info | Menú |
| #ping | Latencia |
| #stats | Estadísticas, solo propietario |
| #tt, #tta, #ttaud | TikTok video/fotos o audio |
| #reel, #r | Instagram Reel |
| #post, #p [posición] | Instagram post o carrusel |
| #fb, #tw, #pin | Facebook, X, Pinterest |
| #ytv, #ytvid | YouTube video |
| #yta, #ytaud, #music | YouTube audio |
| #ytinfo | Información YouTube |
| #sc, #soundcloud | SoundCloud |
| #s, #sticker | Sticker de imagen, GIF, video o WebP |
| #sm, #smedia | Sticker a PNG/MP4, con audio si disponible |
| #toa, #toaud | Extraer MP3 |
| #toi, #toimg [página] | PDF, Word o Excel a imagen |
| #tot, #totext [idioma] | OCR o transcripción |
| #traducir, #trans destino [origen] | Traducción de texto citado |
| #qr [texto] | QR de texto/enlace |
| #bcv, #usdt | Cotizaciones compactas |

Las descargas admiten enlaces citados; YouTube y SoundCloud también búsquedas. Los comandos de conversión y utilidades usan reacciones ⏳, ✅ y ❌; se mantienen resultados y errores útiles. Menú, ping y estadísticas no generan reacciones. Las reacciones son best effort.

## Railway y configuración

1. Conectar el repositorio, seleccionar la rama de despliegue y utilizar Dockerfile/railway.toml.
2. Mantener una réplica y un volumen persistente (habitualmente /data). Conservar AUTH_DIR y el directorio de sesión ya validados. Nunca arrancar dos bots con la misma sesión.
3. Revisar .env.example. Railway asigna PORT. No publicar dominio si no se necesita.
4. Vincular por QR únicamente si es necesario, desde logs privados; no compartir QR ni archivos de credenciales.
5. /health verifica liveness aun sin vinculación. /ready responde 503 hasta la conexión. Reiniciar y confirmar persistencia.
6. Para rollback, volver a la última imagen/commit estable con el mismo volumen y una sola instancia. No borrar ni modificar la sesión automáticamente.

| Variable | Uso |
|---|---|
| AUTH_DIR, RAILWAY_VOLUME_MOUNT_PATH | Sesión persistente |
| TEMP_DIR | Temporales por trabajo (no usar directorio de sesión) |
| MAX_MEDIA_JOBS | Concurrencia multimedia, valor actual del operador; defecto 2 |
| MAX_MEDIA_MB | Límite global, defecto 100 MiB |
| LOG_LEVEL, BAILEYS_LOG_LEVEL | Logs; info/warn por defecto |
| BOT_OWNER_JID | JID PN o LID autorizado para estadísticas |
| ASSEMBLYAI_KEY | Transcripción externa, opcional |
| EXPERIMENTAL_SOUND_STICKERS | true habilita audio experimental |
| INSTAGRAM_POST_PROVIDER, APIDIRECT_API_KEY | Alternativa opcional para publicaciones |
| STICKER_LEGACY_MAX_KIB | 1024 habilita presupuesto histórico solo para candidato de video; por defecto 500 |
| FFMPEG_PATH, FFPROBE_PATH, YTDLP_PATH, GALLERY_PYTHON, LIBREOFFICE_PATH | Rutas de herramientas, opcionales |
| TZ | Zona horaria del proceso; tasas usan America/Caracas explícitamente |

No cambiar valores validados al actualizar. Cobalt, OCR.Space, ExchangeRate-API y cookies de Instagram ya no se usan. Pueden retirarse de Railway únicamente si ningún otro servicio las comparte. No se revocan claves ni modifican variables desde este PR. Si cookies o claves se expusieron en el historial/logs, revocarlas en origen; eliminarlas de la rama no borra el historial.

### Instalación local
Node.js >=22, npm >=10, FFmpeg/FFprobe, yt-dlp con EJS y runtime Node, gallery-dl, LibreOffice Writer/Calc, Poppler, Tesseract con spa+eng y fuentes. Para compilar Canvas/Sharp cuando no haya binarios compatibles, instalar bibliotecas del Dockerfile. Ejecutar npm ci y npm start. Docker es la referencia de producción. No utilizar dependencias FFmpeg antiguas ni cookies versionadas.

## Multimedia y stickers

Lienzo 512×512, recorte centrado, hasta 15 s y 450 cuadros; estáticos hasta 100 KiB, animados hasta 500 KiB en el motor principal. Ajuste gradual de calidad, detalle y FPS (hasta 30 según fuente; reserva puede bajar a 6). Los videos complejos pueden superar el presupuesto y fallar con un mensaje explícito. No se recorta automáticamente el contenido. WebP validado por estructura y muestras decodificadas.

Se conserva íntegra la implementación validada del PR #26: una vez obtenido un resultado válido de video opaco con recorte, si detalle <384 o calidad <50, se puede intentar el perfil histórico libwebp a resolución completa, sin reducir FPS frente al resultado principal. Temporales separados, hasta 12 s dentro del presupuesto global. Si falla, se conserva el resultado válido. STICKER_LEGACY_MAX_KIB=1024 permite 1 MiB solo para ese candidato; supera la recomendación de paquetes de stickers animados. La aceptación por todos los clientes no está garantizada. Los 15 s también exceden los 10 s documentados para paquetes oficiales. El operador confirmó reproducción PC/móvil, nitidez, movimiento, sonido y recuperación en PR #26; no se garantiza ausencia de artefactos para todos los clips.

El audio experimental usa una extensión en memoria del campo 26 StickerMessage en Baileys, con Opus y subida cifrada. No usa fork ni cambia la sesión. Se habilita con EXPERIMENTAL_SOUND_STICKERS=true. Compatible en privado y grupos según pruebas del operador. El wrapper 134 no se implementa. #sm recupera audio presente en la cita o referencia de caché del mismo chat, ID y hash; hasta 512 entradas y una hora, sin persistencia. No recupera sonido ausente de WebP por sí solo. MP4 H.264, AAC cuando hay audio, fondo negro para alfa y decodificación por lotes. Metadatos UntrueBot y fecha sin nombre de usuario. #toa extrae MP3 de audio/video hasta 10 min.

## Descargas

YouTube y SoundCloud: yt-dlp local 2026.11.23, EJS y Node; MP4 H.264/AAC hasta 720p, MP3 192 kbps, video 30 min/audio 60 min. Sin directos ni playlists; verificación FFprobe, presupuesto de 120 s de yt-dlp y vigilancia aproximada de almacenamiento temporal. No garantiza formatos externos ni acceso desde Railway.

Redes sociales: yt-dlp para video TikTok, Reel y Facebook; gallery-dl 1.32.21 para galerías TikTok, Instagram y Pinterest, adaptador TikTok en proceso separado como respaldo, PinResource/metadatos del pin exacto, BK9/embed público para Instagram y FxTwitter para X. No se confunden portadas con videos. Carruseles máximo 20 elementos, MAX_MEDIA_MB acumulado, preparación hasta 180 s, dominios y redirecciones restringidos, envío después de validar archivos. Fallback solo por indisponibilidad, timeout o formato; no por restricciones explícitas ni tras envío parcial. Video compatible se conserva; los demás se normalizan. Pinterest MP4 faststart y decodificación comprobada. Solo contenido autorizado y público, sin credenciales para eludir acceso.

Instagram Post: si INSTAGRAM_POST_PROVIDER=apidirect y APIDIRECT_API_KEY, se intenta primero API Direct. El contador preventivo de 40 intentos/mes UTC es por proceso, no una cuota global persistente; comprobar condiciones y consumo en cuenta del proveedor. No configurar facturación para el uso gratuito. La clave se envía solo al endpoint fijo y no a CDN. HTTP 429 activa pausa de al menos 15 min en memoria, respetando Retry-After mayor, sin reintentar otro proveedor por restricción. El resto usa proveedores públicos. No se garantiza disponibilidad.

## Convertidores y utilidades

- #toi: PDF/DOC/DOCX/XLS/XLSX, hasta 50 MiB de entrada (también MAX_MEDIA_MB), 20 páginas por solicitud o una específica. LibreOffice usa perfil temporal y configuración restrictiva de macros/enlaces; Poppler hasta 2200 px. No constituye una sandbox completa.
- #tot: OCR local Tesseract spa+eng para imágenes; audio/video hasta 10 min por AssemblyAI universal-2, idioma automático o explícito. El servicio externo recibe audio; borrado remoto best effort, sujeto a retención y tarifas del proveedor. OCR no requiere clave. Textos extensos como TXT.
- #traducir: Google no oficial; MyMemory como alternativa para idioma de origen explícito y <=500 bytes. Envía texto a servicios externos. #qr local, hasta 1000 bytes.
- #bcv: DolarApi /v1/cotizaciones, datos de fuente BCV, USD y EUR; caché 15 min. No usa referencias históricas como vigentes.
- #usdt: Binance P2P vía CriptoYa, promedio de compra/venta, cotización reciente, caché 60 s. Ambos comandos muestran cuatro decimales, dd/mm/aaaa America/Caracas y dominio de fuente sin vista previa.

## Seguridad, operación y límites

Sesión Baileys con escritura atómica por archivo, codec compatible con claves LID y categorías nuevas; no se eliminan credenciales corruptas. Logs del protocolo sanitizados, guardia de console libsignal, no imprimir contenidos ni claves. Se mantienen tiempos de consultas, reconexión con backoff, deduplicación, colas acotadas, caché temporal de mensajes y audio. Se omite historial RECENT después de sincronización de identidad. Diagnóstico: incomingAgeMs, queueMs, ms y retraso event loop. No registrar ni compartir QR fuera de logs privados. No reusar sesión en procesos simultáneos. No se cambia la gestión de sesión ni el motor multimedia en la consolidación.

Los procesos externos tienen límites y temporales aislados; la mayoría de proveedores y conversiones documentales usan entorno restringido. Las herramientas multimedia no equivalen a aislamiento completo de procesos o cuota estricta de disco. Los límites y redirecciones de aplicación no sustituyen políticas de red y control de recursos de infraestructura. El uso de Baileys y proveedores públicos no garantiza continuidad ni soporte de Meta. Revisar logs/consumo en Railway después del deploy; el repositorio no proporciona acceso a métricas de producción.

## CI y mantenimiento

- npm run verify: sintaxis JS. npm test: pruebas unitarias sin conexión a WhatsApp.
- Docker build y npm ls de dependencias de producción; smoke tests reales de Baileys sin conexión, stickers/sonido, música, redes y documentos/OCR con fixtures y proveedores simulados. No publica mensajes reales.
- Artefacto untrue-audit: árbol instalado, tamaño de imagen en bytes y npm audit (JSON, stderr, código de salida). Audit informativo; comprobar resultados, no confundir un fallo de red con ausencia de vulnerabilidades. No actualizar automáticamente versiones ni usar npm audit fix --force.
- Antes de fusionar: todos los checks verdes. Después: validar comandos, stickers HD/no HD en PC/móvil y audio, tasas, carruseles, documentos, reconexión y métricas.

## Consolidación 2.0

Se retiran descargadores anteriores no referenciados, wrapper de YouTube, auxiliares históricos de tasas sin consumidores y dependencias directas obsoletas. Se conservan versiones bloqueadas y dependencias transitivas requeridas, incluidas Canvas/TikTok y los peers de Baileys. Se retira ImageMagick, no invocado por los motores actuales; se mantienen herramientas nativas necesarias para OCR, Office, Poppler, FFmpeg y compilación. No se modifica ningún motor de stickers, música, redes sociales, almacenamiento de sesión, cola o protocolo. Historial técnico: PR #3–#26 y commits anteriores. La versión 2.0.0 del paquete se propone en este PR; etiqueta/release definitivo solo después de verificar CI y producción.
