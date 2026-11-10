# SnapTudo

Extensão Manifest V3 para Chrome, Edge, Brave e outros navegadores Chromium. Ela detecta e baixa mídias acessíveis na página atual, oferece ferramentas para Instagram, Facebook, HLS e um fluxo assistido para YouTube.

> Use somente em conteúdo próprio ou quando você tiver autorização para baixar. Respeite direitos autorais, termos das plataformas e as leis aplicáveis.

## Recursos

- Instagram: fotos, vídeos, carrosséis, stories e pacote ZIP com legenda e metadados.
- Facebook: detecção de vídeos acessíveis no feed, reels e watch.
- HLS/M3U8: captura de playlists e download de segmentos compatíveis, inclusive AES-128 quando a chave está acessível.
- Sniffer universal: lista imagens, vídeos e fluxos encontrados na aba.
- Gravação do player: usa `captureStream()`/`MediaRecorder` quando o navegador e o site permitem.
- YouTube: usa o sidecar opcional com yt-dlp para baixar vídeo e áudio localmente. Cobalt e gravação do player permanecem como alternativas. O Chrome e o próprio YouTube mudam o player com frequência, portanto não há promessa de disponibilidade permanente.

## Instalação

1. Baixe o ZIP da [última versão](https://github.com/eddysangalli/snaptudo/releases/latest).
2. Extraia para uma pasta permanente, por exemplo `C:\Apps\SnapTudo`.
3. Abra `chrome://extensions/` (ou a página equivalente do seu navegador).
4. Ative **Modo do desenvolvedor**.
5. Clique em **Carregar sem compactação** e selecione a pasta extraída.

Não carregue diretamente uma pasta temporária ou o ZIP.

### Motor opcional yt-dlp

1. Na mesma Release, baixe `snaptudo-sidecar-vX.Y.Z-win-x64.zip` e seu `.sha256`.
2. Confira o SHA-256, extraia o pacote e execute `install-sidecar.ps1`.
3. Recarregue a extensão.

O sidecar é registrado somente para o ID fixo `epjkbhcahfaojangofedoginhmcjbfol`. Ele aceita apenas links HTTPS do YouTube e sempre desativa playlists. Com FFmpeg instalado, combina vídeo e áudio em MP4 até 1080p; sem FFmpeg, tenta um formato combinado de até 720p. Veja [sidecar/README.md](sidecar/README.md).

## Canal de atualizações

O projeto separa atualizações de dados e de código:

- **Receitas declarativas:** `recipes/recipes.json` é consultado no GitHub a cada 6 horas e pelo botão **Verificar agora**. A extensão valida a estrutura, a versão mínima e os domínios permitidos antes de aplicar. Nenhum JavaScript remoto é executado.
- **Código da extensão:** a última Release estável do GitHub é comparada com a versão instalada. Quando houver uma versão nova, o popup oferece o ZIP oficial para download.

Uma extensão carregada sem compactação não tem permissão para reescrever a própria pasta. Depois de baixar uma versão nova, extraia-a sobre a pasta atual e clique em **Recarregar** na página de extensões. Instalação de código totalmente automática no Windows exige publicação na Chrome Web Store ou um aplicativo nativo separado (sidecar).

## Publicar uma versão

1. Altere `version` em `manifest.json`.
2. Atualize e teste as receitas, se necessário.
3. Execute `./scripts/verify.ps1`.
4. Crie e envie uma tag igual à versão, por exemplo: `git tag v1.2.2` e `git push origin v1.2.2`.
5. O workflow gera `snaptudo-v1.2.2.zip` e `snaptudo-sidecar-v1.2.2-win-x64.zip`, publica os SHA-256 e cria a Release.

O endpoint público consultado pela extensão é a API de `releases/latest` deste repositório. Releases marcadas como rascunho ou pré-lançamento não entram no canal estável.

## Estrutura

```text
background/   service worker, downloads, sniffer e atualizador
content/      integrações injetadas nas páginas
icons/        ícones da extensão
lib/          bibliotecas locais redistribuíveis
popup/        interface da extensão
recipes/      configuração declarativa atualizável
scripts/      validação e empacotamento
sidecar/      host Native Messaging em Go e integração yt-dlp
tests/        testes automatizados do canal de atualização
```

## Privacidade e licenças

Leia [PRIVACY.md](PRIVACY.md) para entender rede, permissões e dados locais. Dependências redistribuídas estão em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). A publicação do código neste repositório não concede uma licença ampla de reutilização; consulte [LICENSE](LICENSE).
