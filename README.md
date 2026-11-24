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
