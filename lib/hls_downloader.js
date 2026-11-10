/**
 * SnapTudo - HLS (M3U8) Downloader Engine 🌶️
 * Motor profissional em JavaScript puro para baixar fluxos HLS (m3u8), FMP4 e TS.
 * Suporta: Master Playlists, FMP4 com Init Segment (#EXT-X-MAP), AES-128,
 * herança de tokens de query string (Globo/G1/GE) e fallback de bypass CORS via Background.
 */

class SnapTudoHlsDownloader {
  constructor(options = {}) {
    this.concurrency = options.concurrency || 5;
    this.abortController = new AbortController();
    this.isAborted = false;
  }

  abort() {
    this.isAborted = true;
    this.abortController.abort();
  }

  // Fetch resiliente com fallback automático via Background para contornar CORS
  async safeFetchBuffer(url) {
    try {
      const resp = await fetch(url, { signal: this.abortController.signal });
      if (resp.ok) {
        return await resp.arrayBuffer();
      }
      throw new Error(`HTTP ${resp.status}`);
    } catch (directErr) {
      // Fallback via Background Service Worker (sem restrição de CORS)
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          action: "fetchThroughBackground",
          url
        }, (res) => {
          if (chrome.runtime.lastError || !res || !res.success) {
            reject(new Error(res?.error || directErr.message));
          } else {
            const binary = atob(res.base64);
            const len = binary.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
              bytes[i] = binary.charCodeAt(i);
            }
            resolve(bytes.buffer);
          }
        });
      });
    }
  }

  async safeFetchText(url) {
    try {
      const resp = await fetch(url, { signal: this.abortController.signal });
      if (resp.ok) {
        return await resp.text();
      }
      throw new Error(`HTTP ${resp.status}`);
    } catch (directErr) {
      const buffer = await this.safeFetchBuffer(url);
      const decoder = new TextDecoder("utf-8");
      return decoder.decode(buffer);
    }
  }

  // Parsear lista M3U8 com suporte a FMP4 e Tokens de autorização
  async parseM3U8(url) {
    const text = await this.safeFetchText(url);
    const baseUrl = new URL(url, window.location.href);

    // 1. Verificar se é Master Playlist com diferentes qualidades
    if (text.includes("#EXT-X-STREAM-INF")) {
      const variants = [];
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("#EXT-X-STREAM-INF:")) {
          const resMatch = line.match(/RESOLUTION=(\d+x\d+)/i);
          const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
          const resolution = resMatch ? resMatch[1] : "Desconhecido";
          const bandwidth = bwMatch ? parseInt(bwMatch[1], 10) : 0;

          let nextUrlLine = "";
          for (let j = i + 1; j < lines.length; j++) {
            const nextL = lines[j].trim();
            if (nextL && !nextL.startsWith("#")) {
              nextUrlLine = nextL;
              break;
            }
          }

          if (nextUrlLine) {
            let variantUrl = new URL(nextUrlLine, baseUrl).href;
            // Se a URL filha não tiver query e a pai tiver (tokens da Globo), herdar
            if (!nextUrlLine.includes("?") && baseUrl.search) {
              variantUrl += baseUrl.search;
            }
            variants.push({
              resolution,
              bandwidth,
              url: variantUrl
            });
          }
        }
      }

      if (variants.length > 0) {
        variants.sort((a, b) => b.bandwidth - a.bandwidth);
        return { isMaster: true, variants };
      }
    }

    // 2. Media Playlist (Segmentos diretos e Init Segment)
    const segments = [];
    let initSegmentUrl = null;
    let keyInfo = null;
    const lines = text.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Suporte a Fragmented MP4 (FMP4) comum na Globo: #EXT-X-MAP:URI="init.mp4"
      if (line.startsWith("#EXT-X-MAP:")) {
        const mapUriMatch = line.match(/URI=["']([^"']+)["']/i);
        if (mapUriMatch) {
          let initUrl = new URL(mapUriMatch[1], baseUrl).href;
          if (!mapUriMatch[1].includes("?") && baseUrl.search) {
            initUrl += baseUrl.search;
          }
          initSegmentUrl = initUrl;
        }
      } else if (line.startsWith("#EXT-X-KEY:")) {
        const methodMatch = line.match(/METHOD=([A-Z0-9-]+)/i);
        const uriMatch = line.match(/URI=["']([^"']+)["']/i);
        const ivMatch = line.match(/IV=(0x[0-9a-fA-F]+)/i);

        if (methodMatch && methodMatch[1] === "AES-128" && uriMatch) {
          let kUrl = new URL(uriMatch[1], baseUrl).href;
          if (!uriMatch[1].includes("?") && baseUrl.search) {
            kUrl += baseUrl.search;
          }
          keyInfo = {
            method: "AES-128",
            keyUrl: kUrl,
            iv: ivMatch ? ivMatch[1] : null
          };
        }
      } else if (line && !line.startsWith("#")) {
        let segUrl = new URL(line, baseUrl).href;
        if (!line.includes("?") && baseUrl.search) {
          segUrl += baseUrl.search;
        }
        segments.push(segUrl);
      }
    }

    return {
      isMaster: false,
      segments,
      initSegmentUrl,
      keyInfo
    };
  }

  // Baixar chave AES se necessário
  async fetchKey(keyInfo) {
    if (!keyInfo || !keyInfo.keyUrl) return null;
    const buffer = await this.safeFetchBuffer(keyInfo.keyUrl);
    return await crypto.subtle.importKey(
      "raw",
      buffer,
      { name: "AES-CBC" },
      false,
      ["decrypt"]
    );
  }

  // Descriptografar segmento AES-128
  async decryptSegment(cryptoKey, ivArrayBuffer, dataBuffer) {
    return await crypto.subtle.decrypt(
      { name: "AES-CBC", iv: ivArrayBuffer },
      cryptoKey,
      dataBuffer
    );
  }

  // Executar download completo dos segmentos com concorrência e montagem MP4
  async downloadStream(m3u8Url, onProgress = () => {}) {
    this.isAborted = false;
    this.abortController = new AbortController();

    let parsed = await this.parseM3U8(m3u8Url);
    let targetUrl = m3u8Url;

    if (parsed.isMaster && parsed.variants.length > 0) {
      targetUrl = parsed.variants[0].url;
      parsed = await this.parseM3U8(targetUrl);
    }

    const segments = parsed.segments;
    if (!segments || segments.length === 0) {
      throw new Error("Nenhum segmento de vídeo encontrado no arquivo M3U8.");
    }

    // Carregar chave de criptografia se houver
    let cryptoKey = null;
    if (parsed.keyInfo) {
      cryptoKey = await this.fetchKey(parsed.keyInfo);
    }

    // Baixar Init Segment de FMP4 se presente (Essencial para vídeos da Globo)
    let initBuffer = null;
    if (parsed.initSegmentUrl) {
      try {
        initBuffer = await this.safeFetchBuffer(parsed.initSegmentUrl);
      } catch (e) {
        console.warn("[SnapTudo HLS] Falha ao baixar init segment:", e);
      }
    }

    const total = segments.length;
    let completed = 0;
    const downloadedBuffers = new Array(total);
    let segmentIndex = 0;
    const startTime = Date.now();

    const downloadWorker = async () => {
      while (segmentIndex < total && !this.isAborted) {
        const currentIndex = segmentIndex++;
        const segUrl = segments[currentIndex];

        let retries = 3;
        let success = false;

        while (retries > 0 && !success && !this.isAborted) {
          try {
            let buffer = await this.safeFetchBuffer(segUrl);

            // Descriptografar se necessário
            if (cryptoKey) {
              let iv = new Uint8Array(16);
              if (parsed.keyInfo.iv) {
                const hex = parsed.keyInfo.iv.replace("0x", "").padStart(32, "0");
                for (let k = 0; k < 16; k++) {
                  iv[k] = parseInt(hex.substr(k * 2, 2), 16);
                }
              } else {
                const view = new DataView(iv.buffer);
                view.setUint32(12, currentIndex);
              }
              buffer = await this.decryptSegment(cryptoKey, iv, buffer);
            }

            downloadedBuffers[currentIndex] = buffer;
            completed++;
            success = true;

            const elapsedSec = (Date.now() - startTime) / 1000;
            const percent = Math.round((completed / total) * 100);
            onProgress({
              total,
              completed,
              percent,
              elapsedSec: Math.round(elapsedSec)
            });
          } catch (err) {
            retries--;
            if (retries === 0) {
              console.warn(`[SnapTudo HLS] Segmento ${currentIndex} falhou:`, err);
            } else {
              await new Promise(r => setTimeout(r, 600));
            }
          }
        }
      }
    };

    const workers = [];
    const numWorkers = Math.min(this.concurrency, total);
    for (let w = 0; w < numWorkers; w++) {
      workers.push(downloadWorker());
    }

    await Promise.all(workers);

    if (this.isAborted) {
      throw new Error("Download cancelado pelo usuário.");
    }

    const validBuffers = downloadedBuffers.filter(Boolean);
    if (validBuffers.length === 0) {
      throw new Error("Falha ao baixar segmentos do vídeo.");
    }

    // Montar o buffer completo (Init Segment primeiro, seguido dos segmentos)
    let totalLength = initBuffer ? initBuffer.byteLength : 0;
    for (const b of validBuffers) {
      totalLength += b.byteLength;
    }

    const merged = new Uint8Array(totalLength);
    let offset = 0;

    if (initBuffer) {
      merged.set(new Uint8Array(initBuffer), 0);
      offset += initBuffer.byteLength;
    }

    for (const b of validBuffers) {
      merged.set(new Uint8Array(b), offset);
      offset += b.byteLength;
    }

    // Se tiver initBuffer (FMP4), o tipo é video/mp4 puro
    const mimeType = initBuffer ? "video/mp4" : "video/mp2t";
    return new Blob([merged], { type: mimeType });
  }
}

window.SnapTudoHlsDownloader = SnapTudoHlsDownloader;
