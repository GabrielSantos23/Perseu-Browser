# Perseu: anotações de build, release e atualização

Pasta só local (listada em `.git/info/exclude`). Não contém segredos.

Situação em 2026-11-10: Perseu 157.0.8103.44 publicado (com PGO).

## Onde fica cada coisa

| O quê | Onde |
|---|---|
| Código do shell e scripts (trabalho do dia a dia) | `D:\projects\flecha-browser` (origin do Luciano, só leitura) |
| Repositório de release e CI, público | `D:\projects\Perseu-Browser`, `GabrielSantos23/Perseu-Browser`, branch `master` |
| Árvore do Chromium | `C:\uc\build\src` (`out\Default` é a saída) |
| Patch único do Perseu | `C:\uc\flecha-chromium-157.patch` |
| Cópias do patch | `flecha-browser\chromium\patches-windows\` e `Perseu-Browser\flecha\` |
| Chave privada do updater | `C:\uc\perseu-update-signing-key.pem` |
| Chave pública do updater | `chromium/shell/features/updates.ts` |
| Instalador 38, para testar a atualização | `C:\uc\perseu-157.0.8103.38-installer.exe` |

**Faça backup da chave privada e nunca a coloque em um repositório.** Sem ela, as cópias instaladas não aceitam versões novas. Se ela vazar, alguém pode publicar uma atualização falsa.

Os scripts auxiliares estão em `docs/scripts/`. Eles ainda citam a pasta temporária onde foram criados, então ajuste o caminho `W` em `export_patch.sh` se ela sumir.

## Compilar localmente

Feche só os processos com caminho em `C:\uc\`; nunca o Chrome normal.

Shell:

```bash
cd /d/projects/flecha-browser
npx tsc -p chromium/shell
FLECHA_MIN_CHROME=157 node chromium/shell/build.mjs
```

C++ e WebUI (log em `C:\uc\build.log`; leia com `tr -d '\000'`):

```bash
powershell -File docs/scripts/run-build.ps1
```

Instalador:

```bash
bash chromium/scripts/stage-windows-release.sh C:/uc/build/src/out/Default
cd /c/uc/build/src/out/Default
DEPOT_TOOLS_WIN_TOOLCHAIN=0 ../../third_party/ninja/ninja.exe mini_installer
```

Se só o shell mudou, o ninja não percebe. Rode `touch chrome/installer/mini_installer/chrome.release` antes e confira o conteúdo em `gen/chrome/installer/mini_installer/mini_installer/temp_installer_archive`.

Testar com perfil descartável:

```text
chrome.exe --flecha-shell-dir=D:\projects\flecha-browser\chromium\shell\dist --flecha-extensions-dir=D:\projects\flecha-browser\chromium\extensions\dist --user-data-dir=%TEMP%\perseu-test --no-first-run --remote-debugging-port=9333
```

Reiniciar não recarrega o service worker do shell: use `chrome.runtime.reload()` pelo alvo do service worker.

## Exportar o patch

1. Antes de editar pela primeira vez um arquivo do Chromium, guarde o original: `tar -rf /c/uc/pre-flecha-backup2.tar <arquivo>`.
2. Acrescente o caminho em `C:\uc\flecha-touched.txt`.
3. Rode `export_patch.sh`.
4. Copie o patch para `patches-windows` e para `Perseu-Browser\flecha\`.

`chrome/VERSION` não entra no patch, de propósito: o número vem do upstream.

## Publicar à mão

Só publique um número maior que o da última release.

1. Aumente `PATCH` em `chrome/VERSION` e compile.
2. Gere o instalador.
3. Publique:

```bash
PERSEU_UPDATE_KEY=C:/uc/perseu-update-signing-key.pem node chromium/scripts/publish-windows-update.mjs C:/uc/build/src/out/Default/mini_installer.exe <versão> --publish
```

Sem `--publish`, o script só gera o manifesto assinado.

Teste do manifesto: `node --experimental-strip-types chromium/scripts/update-feed.test.mjs`.

## Como o updater funciona

- `features/updates.ts` verifica a cada 6 horas e no botão **Settings → General → Perseu updates**.
- O manifesto `perseu-update.json` traz versão, URL e SHA-256, assinados com Ed25519. O shell confere a assinatura.
- `flechaPrivate.prepareUpdate` (C++) recusa versão não maior, exige HTTPS, baixa e confere o hash.
- `flechaPrivate.installUpdate` roda o instalador só no clique em **Restart to Update** e reinicia.
- Só funciona em cópia instalada por usuário, que tenha `<versão>\Installer\setup.exe`. Em `out\Default` aparece "unsupported".

## Extensões

- Patches: URL real em `extensions/common/extension_urls.cc`, `StartUpdateCheck` restaurado em `extension_downloader.cc` e `CanUseUpdateService` retornando falso em `extension_updater.cc`.
- A atualização envia ao Google os IDs e as versões das extensões da loja.
- Extensões registradas por outros programas no Windows são ignoradas.
- O uBlock vem dentro do Perseu e só muda em release nova. A versão fica em `chromium/extensions/fetch.mjs`. As listas de filtros ele baixa sozinho.

## Workflow automático: `perseu-auto.yml`

A cada 6 horas compara o Chromium do upstream, faz merge em `auto/<versão>`, compila em até 16 etapas (`reusable-build.yml`), assina, publica e atualiza `master`. Falhas abrem uma issue.

Para ligar:

1. Enviar o workflow para `master` (agendamentos só rodam no branch padrão).
2. Ativar Actions em Settings → Actions → General.
3. Cadastrar a chave:

```bash
gh secret set PERSEU_UPDATE_KEY --repo GabrielSantos23/Perseu-Browser < C:/uc/perseu-update-signing-key.pem
```

Depois de corrigir uma falha, rode `perseu-auto` manualmente com `force`, pois o branch `auto/<versão>` impede nova tentativa automática.

Limites conhecidos:

- Chromium novo pode exigir portar o patch à mão, principalmente em versão major.
- O token padrão não envia merges que alterem `.github/workflows`; isso vira issue.
- Só o caminho até "merge com upstream" e a sintaxe YAML foram validados; o workflow nunca rodou no GitHub.

## Problemas já vistos

| Sintoma | Causa e solução |
|---|---|
| `AssertionError` em `midl.py`, `contents[0:8] == b'MSFT...'` | `.tlb` vazio deixado em `third_party/win_build_output/midl`. Apague os arquivos de 0 bytes e recompile. Só acontece em build incremental |
| `Did not find an archive input file` | Pasta não registrada em `g_archive_inputs` em `create_installer_archive.py` |
| Ícone novo não aparece | Apague os `.res`; o ninja não detecta o `.ico` |
| Heredoc estraga barras invertidas | Escreva os scripts Python em arquivo |

## Onboarding

- A janela inicial nasce em 960×600, centralizada e sem botões, e cresce ao terminar. É a mesma janela do navegador: `BrowserView::GetSavedWindowPlacement` decide o tamanho inicial pela pref `flecha.welcome_done`, e `FlechaFrameView::SetWelcome` faz as transições.
- Visual em `chromium/shell/ui/onboarding.ts` e `onboarding.css`. A fonte é Palatino Linotype, do Windows, sem arquivo embutido.
- Imagens em `chromium/shell/ui/art-*.webp`, 755 KB no total. As de Atena e do vaso tiveram o fundo removido.

| Arquivo | Obra | Licença |
|---|---|---|
| `art-perseus` | Burne-Jones, estudo de Perseu de armadura | Domínio público |
| `art-athena` | Cabeça de Atena em mármore, The Met (DP119213) | CC0 |
| `art-atlas` | Burne-Jones, Atlas Turned to Stone, 1878 | Domínio público |
| `art-vase` | Pelike de terracota, The Met (DT352033) | CC0 |
| `art-baleful` | Burne-Jones, The Baleful Head, 1885 | Domínio público |

Todas vieram do Wikimedia Commons. Licença conforme informada lá.

`art-cellini` (Perseu de Cellini, passo II) e `art-perseus-medusa` (escultura digital, passo III) vieram de imagens enviadas pelo usuário: **licença e autoria não verificadas; confirme antes de publicar um instalador com elas**.

No Windows, navegadores são lidos pelo processo do navegador (`flecha_browser_import.cc`): favoritos e histórico de Chrome, Edge, Brave, Vivaldi, Opera, Helium, Chromium, Firefox, Zen, LibreWolf, Waterfox e Floorp. Cookies e senhas não são importados.

## Pendências

- [ ] Testar de verdade: instalar a 38 e atualizar para a 39.
- [ ] Ver uma extensão da loja mudar de versão de fato.
- [ ] Certificado de assinatura de código (Certum open source ou SignPath são candidatos, agora que o repositório é público). Sem ele, o SmartScreen avisa.
- [ ] Canal separado para atualizar só o shell, se valer a pena.
- [ ] "Add tabs or files" e microfone na home continuam inativos.
- [ ] Decidir sobre tradução da interface.
