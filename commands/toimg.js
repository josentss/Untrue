import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync, readdirSync, existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'util';
import { downloadContentFromMessage } from 'baileys';

const execPromise = promisify(exec);
const LIBREOFFICE = process.env.LIBREOFFICE_PATH || 'libreoffice';
const CONVERT = process.env.CONVERT_PATH || 'convert';

export async function toimgCommand(sock, m, args) {
    let tempDir;

    try {
        await checkDependencies();

        const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;

        if (!quoted?.documentMessage) {
            await sock.sendMessage(m.key.remoteJid, {
                text: 'Responde a un documento (PDF, DOCX, XLSX) con #toi\nOpcional: #toi 2 para una página específica'
            }, { quoted: m });
            return;
        }

        const doc = quoted.documentMessage;
        const fileName = doc.fileName || 'documento';
        const ext = fileName.split('.').pop().toLowerCase();
        const supported = ['pdf', 'docx', 'doc', 'xlsx', 'xls'];

        if (!supported.includes(ext)) {
            await sock.sendMessage(m.key.remoteJid, {
                text: `Formato no soportado: ${ext.toUpperCase()}\nUsa PDF, DOCX o XLSX`
            }, { quoted: m });
            return;
        }

        const page = args[0] ? parseInt(args[0]) : null;
        if (page !== null && (isNaN(page) || page < 1)) {
            await sock.sendMessage(m.key.remoteJid, {
                text: 'Número de página inválido. Ejemplo: #toi 2'
            }, { quoted: m });
            return;
        }

        await sock.sendMessage(m.key.remoteJid, {
            text: `Convirtiendo ${fileName}...`
        }, { quoted: m });

        const buffer = await downloadDocument(doc);
        if (!buffer?.length) throw new Error('No se pudo descargar el documento');

        tempDir = join(tmpdir(), `toimg-${Date.now()}`);
        mkdirSync(tempDir, { recursive: true });

        const docPath = join(tempDir, `doc.${ext}`);
        writeFileSync(docPath, buffer);

        const images = await convertToImages(docPath, tempDir, ext);
        if (!images.length) throw new Error('No se generaron imágenes');

        const total = images.length;
        const pages = page
            ? (page > total ? (() => { throw new Error(`El documento solo tiene ${total} página(s)`); })() : [page - 1])
            : images.map((_, i) => i);

        for (const i of pages) {
            let imgBuffer = readFileSync(images[i]);

            if (imgBuffer.length > 2 * 1024 * 1024) {
                imgBuffer = await optimizeImage(imgBuffer);
            }

            await sock.sendMessage(m.key.remoteJid, {
                image: imgBuffer,
                caption: `${fileName} — Página ${i + 1}/${total}`
            }, { quoted: i === pages[0] ? m : undefined });

            if (pages.length > 1) await new Promise(r => setTimeout(r, 800));
        }

        if (pages.length > 1) {
            await sock.sendMessage(m.key.remoteJid, {
                text: `Listo: ${pages.length} página(s) convertidas.`
            });
        }

    } catch (error) {
        console.error('Error in toimg:', error.message);
        await sock.sendMessage(m.key.remoteJid, {
            text: `Error: ${error.message}`
        }, { quoted: m });
    } finally {
        if (tempDir && existsSync(tempDir)) {
            try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
        }
    }
}

async function checkDependencies() {
    try {
        await execPromise(`${LIBREOFFICE} --version`);
        await execPromise(`${CONVERT} --version`);
        await execPromise("pdftoppm -v");
    } catch {
        throw new Error('LibreOffice o ImageMagick no están disponibles en este servidor');
    }
}

async function downloadDocument(docMessage) {
    const stream = await downloadContentFromMessage(docMessage, 'document');
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
}

async function convertToImages(docPath, outDir, ext) {
    if (ext === 'pdf') return convertPdf(docPath, outDir);

    try {
        const pdfCmd = `"${LIBREOFFICE}" --headless --convert-to pdf --outdir "${outDir}" "${docPath}"`;
        await execPromise(pdfCmd, { timeout: 60000 });

        const pdfs = readdirSync(outDir).filter(f => f.endsWith('.pdf'));
        if (!pdfs.length) throw new Error('No se generó PDF intermedio');

        return convertPdf(join(outDir, pdfs[0]), outDir);
    } catch (error) {
        throw new Error(`Error convirtiendo documento: ${error.message}`);
    }
}

async function convertPdf(pdfPath, outDir) {
    const outPattern = join(outDir, 'page-%03d.png');
    await execPromise(`pdftoppm -f 1 -l 20 -r 150 -png "${pdfPath}" "${join(outDir, "page")}"`, { timeout: 60000 });

    return readdirSync(outDir)
        .filter(f => f.startsWith('page-') && f.endsWith('.png'))
        .sort((a,b) => a.localeCompare(b, undefined, {numeric:true}))
        .map(f => join(outDir, f));
}

async function optimizeImage(buffer) {
    const input = join(tmpdir(), `opt-in-${Date.now()}.png`);
    const output = join(tmpdir(), `opt-out-${Date.now()}.png`);

    try {
        writeFileSync(input, buffer);
        await execPromise(`"${CONVERT}" "${input}" -strip -quality 85 -resize 80% "${output}"`);
        return readFileSync(output);
    } catch {
        return buffer;
    } finally {
        try {
            if (existsSync(input)) unlinkSync(input);
            if (existsSync(output)) unlinkSync(output);
        } catch {}
    }
}
