# Untrue

Bot de WhatsApp (Baileys, Node.js ESM). Usar una única instancia. No utiliza la API oficial de Meta.

## Railway
1. Conectar este repositorio y seleccionar la rama a desplegar. Railway usa Dockerfile y railway.toml.
2. Añadir un volumen persistente en /data; configurar AUTH_DIR=/data/sessions si se desea explicitarlo. No usar réplicas.
3. Configurar las variables de .env.example necesarias. PORT lo asigna Railway. No publicar un dominio si no se necesita.
4. Detener el bot anterior antes de vincular el nuevo; escanear el QR desde los logs privados. No compartir el QR.
5. /health comprueba que HTTP está vivo incluso durante la vinculación; /ready devuelve 503 hasta que WhatsApp esté conectado.
6. Reiniciar y comprobar que el volumen conserva las credenciales. Si el dispositivo se desvincula, revisar la sesión antes de borrar nada.

Las cookies versionadas anteriormente deben revocarse desde las cuentas correspondientes; retirarlas de la rama no elimina su historial. No volver a subirlas. Los archivos de sesión son credenciales, no registros de conversaciones. No se requiere conservar chats históricos.

## Otros hostings
Node 22, ffmpeg/ffprobe, yt-dlp, LibreOffice, Poppler e ImageMagick. npm ci --omit=dev; node index.js. Configurar rutas de binarios y AUTH_DIR mediante variables. Si se colocan binarios en bin/, el detector común los encuentra automáticamente.

## Pruebas
npm test (pruebas unitarias sin WhatsApp). npm run verify (sintaxis). GitHub Actions verifica el código y construye Docker.
Las pruebas de proveedores externos, mensajes reales y stickers con sonido requieren una cuenta vinculada. El formato sonoro no está declarado en el protocolo StickerMessage de la versión bloqueada; no se promete soporte nativo.

## Migración de Baileys 7 (candidata)
Se fija baileys 7.0.0-rc14. El almacén usa los nombres y el codec de Baileys, conserva /data/sessions y permite nuevas categorías de claves (LID, device-list, tctoken, identity-key). Las escrituras son atómicas por archivo; se mantiene una sola instancia. No borra credenciales corruptas automáticamente. El formato interno de las sesiones debe verificarse con una reconexión real. Si hay regresiones, detener el bot antes de volver a la versión previa y, si no acepta la sesión migrada, vincular de nuevo. No ejecutar ambas versiones a la vez.
Los logs del protocolo se sanitizan y agrupan con BAILEYS_LOG_LEVEL=warn; los mensajes directos de dependencias externas pueden quedar fuera del adaptador. BOT_OWNER_JID sigue siendo opcional y obligatorio para acceso a estadísticas, acepta un JID PN o LID que coincida con la identidad de transporte o alternativa de un mensaje recibido.

## Diagnóstico de latencia (Baileys 7)
Los registros de comando distinguen `incomingAgeMs` (antigüedad aproximada según el timestamp de WhatsApp, con resolución de segundos), `queueMs` y `ms` (ejecución). No se almacenan textos ni identificadores. En sesiones ya sincronizadas se omite RECENT, no la sincronización de identidad inicial ni los eventos no bloqueantes. Las consultas de protocolo tienen un límite de 20 s. Las escrituras de claves independientes pueden avanzar en paralelo, hasta ocho operaciones, manteniendo orden por archivo y escrituras atómicas. Las llamadas directas a console desde libsignal se resumen sin imprimir argumentos. Si hubo logs con claves privadas, detener el servicio, desvincular el dispositivo anterior en WhatsApp y cambiar AUTH_DIR a /data/sessions-v7-clean antes de redeploy; no compartir logs antiguos. La nueva vinculación requiere QR, y no se elimina el directorio anterior automáticamente. Si continúa la latencia, considerar volver a la versión validada del PR #3 con una sesión nueva para evitar reutilizar claves migradas. No hay pruebas de conexión real en CI.

## Stickers y multimedia
`#s` / `#sticker` convierte una imagen, GIF, video corto o sticker WebP (también documentos con MIME compatible). `#s recortar` recorta al cuadrado; por defecto preserva proporciones y rellena con transparencia. Se aplican los límites conservadores de los ejemplos oficiales de WhatsApp para packs: 512x512, 100 KiB estático, 500 KiB animado, 10 s (antes 15 s). `#sm` / `#smedia` devuelve PNG o MP4 con movimiento; `#sm imagen` extrae el primer fotograma, `#sm png` lo envía como documento para conservar el PNG y `#sm archivo` entrega el WebP original. MP4 no conserva alfa: se compone sobre negro. `#toa` extrae MP3 de videos y audios (hasta 10 min). Las descargas usan streaming y límites, los temporales se eliminan al finalizar y FFmpeg se ejecuta sin shell. Las animaciones grandes pueden rechazarse por límites de RAM y tamaño; las pruebas no sustituyen la validación real en WhatsApp.
Baileys 7.0.0-rc14 no contiene el campo StickerMessage.audioMessage ni audioStickerMessage. No se implementa un fork, ni se promete soporte nativo. `#s audio` y `#sm audio` informan de esta limitación. Se detectan Lottie y audio cuando los campos son visibles, pero los campos desconocidos descartados por protobuf no pueden identificarse de forma fiable. Un sticker sonoro podría llegar como WebP sin su sonido. La prueba en Docker verifica el round-trip del protocolo y conversiones reales con archivos sintéticos; no vincula WhatsApp.
