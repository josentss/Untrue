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
