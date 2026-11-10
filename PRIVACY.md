# Privacidade do SnapTudo

## Resumo

O SnapTudo não opera um servidor próprio de coleta de dados. A extensão processa a página atual e os downloads localmente no navegador. Ela não deve ser usada para baixar conteúdo sem autorização.

## Permissões

- `downloads`: salvar arquivos solicitados pelo usuário.
- `storage`: guardar receitas validadas, preferências e o último status de atualização.
- `activeTab` e `scripting`: detectar mídia e oferecer controles na aba ativa.
- `webRequest` e acesso a sites: identificar URLs de mídia e playlists acessíveis no navegador.
- `alarms`: verificar receitas e versões periodicamente.
- `nativeMessaging`: comunicar, somente quando instalado, com o sidecar local do SnapTudo que executa yt-dlp.

O acesso amplo a sites é necessário para o sniffer universal. Isso também torna importante instalar somente pacotes obtidos da Release oficial e conferir o repositório antes de cada atualização.

## Comunicações de rede

- GitHub: consulta pública de `recipes/recipes.json` e da última Release.
- Site atual: requisições necessárias para localizar ou baixar a mídia escolhida.
- YouTube: quando o usuário escolhe uma opção assistida, uma nova aba pode ser aberta em `cobalt.tools` ou `9xbuddy.com`. Esses serviços têm políticas próprias e não são operados pelo SnapTudo.
- Sidecar yt-dlp: o aplicativo local acessa o YouTube apenas depois de um clique explícito do usuário. Ele aceita somente URLs HTTPS do YouTube, recusa playlists e salva em `Downloads\SnapTudo`. Logs locais ficam na pasta do sidecar.

## Dados locais

Receitas, preferências e status de atualização ficam no armazenamento local da extensão. Remover a extensão normalmente remove esses dados. Arquivos baixados permanecem na pasta de downloads escolhida pelo usuário.

## Credenciais de sessão

Algumas integrações usam a sessão que já está aberta no site para fazer requisições no mesmo domínio. O SnapTudo não envia cookies ou tokens de sessão ao GitHub.
