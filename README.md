# Vigia

Protótipo autocontido, sem dependências, de um painel de monitoramento de sites em português brasileiro.

## Executar

Abra `index.html` em um navegador moderno. Não há etapa de build ou instalação.

## Instalar no celular

O Vigia pode ser instalado como PWA pelo Chrome em um endereço HTTPS. Abra o endereço do app e use **Instalar app** (ou o menu do Chrome > **Instalar app** / **Adicionar à tela inicial**). Para teste local em um Android conectado por USB com depuração habilitada, sirva esta pasta em `localhost`, encaminhe a porta com `adb reverse` e abra `http://localhost:<porta>` no Chrome do celular. O servidor local precisa permanecer ativo durante o teste; a instalação de produção deve usar um endereço HTTPS permanente.

O service worker mantém apenas o shell estático do app em cache. Chamadas ao Supabase e dados de conta/analytics não são armazenados pelo cache offline.

## Publicar no Cloudflare Pages

Crie um projeto no Cloudflare Pages conectado ao repositório GitHub `zmove-digital/monitor`. Configure o diretório raiz como `/`, sem framework, com o comando de build abaixo e `dist` como diretório de saída:

```sh
mkdir -p dist && cp index.html app.js styles.css supabase-config.js manifest.webmanifest service-worker.js dist/ && cp tracking/vigia.js dist/vigia.js && cp -r icons dist/icons
```

O nome do projeto no Cloudflare Pages pode ser `vigia`; o endereço `vigia.monitor.com` é um domínio personalizado separado. Para usá-lo, adicione `vigia.monitor.com` em **Custom domains** nas configurações do projeto Pages e configure no Cloudflare o DNS para o domínio `monitor.com`. É necessário ter controle desse domínio e de sua zona DNS no Cloudflare; siga o destino de DNS que o painel indicar e aguarde a validação do certificado HTTPS. Não altere os registros de `projetei.com` para publicar o Vigia.

Depois do deploy, defina `https://vigia.monitor.com` como URL do app em **Authentication → URL Configuration** no Supabase e inclua essa URL entre as URLs de redirecionamento permitidas.

## Limites do protótipo

Sem uma conta conectada e um site verificado com snippet instalado, os números do painel são **dados de demonstração**. Com as Edge Functions publicadas e o snippet instalado em um domínio verificado, page views e presença vêm dos eventos gravados no Supabase. Localização e provedor ainda não são coletados e aparecem como indisponíveis.

## Supabase e coleta de acessos

A migration `supabase/migrations/20261101123000_vigia_initial_schema.sql` cria o cadastro de sites, eventos de página, presença temporária e desafios privados de verificação com RLS. Ela já foi aplicada ao projeto VIGIA. As Edge Functions estão em `supabase/functions/`:

- `vigia-verification` cria tokens DNS TXT que expiram em 24 horas e só marca um site como verificado depois de encontrar o token no DNS público. A função exige a sessão autenticada do proprietário.
- `vigia-ingest` aceita page views, encerramentos e heartbeats apenas para domínios verificados, conferindo a origem do navegador contra o domínio cadastrado.

Para publicar as funções no projeto `cmclojrcwjrfezoaidzw`, instale o [Supabase CLI](https://supabase.com/docs/guides/cli), autentique-se na sua máquina e execute:

```sh
npx supabase login
npx supabase link --project-ref cmclojrcwjrfezoaidzw
npx supabase functions deploy vigia-verification --project-ref cmclojrcwjrfezoaidzw
npx supabase functions deploy vigia-ingest --no-verify-jwt --project-ref cmclojrcwjrfezoaidzw
```

O runtime do Supabase fornece `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` às funções. A chave administrativa é usada somente no servidor e nunca deve ser copiada para o app, para o site monitorado, para o GitHub ou para uma conversa. Não é necessário compartilhar a senha do banco.

Depois de publicar as funções e fazer um novo deploy do Pages, registre o domínio no painel, publique o TXT indicado pelo Vigia e confirme a verificação. Após a confirmação, copie o snippet exibido pelo app e coloque-o antes do fechamento de `</body>` em cada página que deseja medir. O trecho carregado é `tracking/vigia.js`, publicado como `/vigia.js` no Pages. O painel coleta page views e presença ativa, com heartbeat a cada 25 segundos e expiração da presença após 90 segundos.

O snippet envia somente o domínio do site, um identificador aleatório efêmero por aba, o caminho da página sem query string nem fragmento, o domínio de referência e duração aproximada. **Nenhum IP é lido, armazenado ou enviado pelo código do Vigia.** Nesta versão, cidade, país e provedor ficam indisponíveis. O identificador de sessão é mantido em `sessionStorage` e termina com a sessão da aba. O proprietário do site deve informar os visitantes sobre analytics e configurar consentimento quando exigido pela legislação aplicável.

O endpoint de ingestão é público por natureza; ele exige site verificado e confere a origem do navegador, mas não inclui ainda limitação distribuída de taxa nem proteção contra clientes que falsifiquem cabeçalhos HTTP fora de um navegador. Trate esta versão como piloto controlado, não como serviço endurecido para produção. Também defina uma política de retenção e configure a limpeza periódica de eventos antes de ampliar a coleta.

A preferência de alerta sonoro fica no navegador e a ativação toca uma prévia curta. Quando há presença real, o painel consulta o Supabase a cada 15 segundos e pode avisar sobre novos visitantes; não há conexão realtime persistente nesta versão.

## Requisitos de privacidade

- Coletar somente os dados necessários para métricas de páginas e localização/provedor aproximados.
- O código de tracking atual não usa o IP. Se enriquecimento aproximado por IP for adicionado no futuro, usar o IP apenas transitoriamente e não reter nem expor o endereço completo.
- Informar que geolocalização por IP pode ser imprecisa. Não inferir localização precisa nem criar fingerprint de visitantes.
- Definir retenção, controles de acesso e aviso de privacidade antes de coletar dados reais.
