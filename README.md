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
mkdir -p dist
cp index.html app.js styles.css supabase-config.js manifest.webmanifest service-worker.js dist/
cp -r icons dist/icons
```

O nome do projeto no Cloudflare Pages pode ser `vigia`; o endereço `vigia.monitor.com` é um domínio personalizado separado. Para usá-lo, adicione `vigia.monitor.com` em **Custom domains** nas configurações do projeto Pages e configure no Cloudflare o DNS para o domínio `monitor.com`. É necessário ter controle desse domínio e de sua zona DNS no Cloudflare; siga o destino de DNS que o painel indicar e aguarde a validação do certificado HTTPS. Não altere os registros de `projetei.com` para publicar o Vigia.

Depois do deploy, defina `https://vigia.monitor.com` como URL do app em **Authentication → URL Configuration** no Supabase e inclua essa URL entre as URLs de redirecionamento permitidas.

## Limites do protótipo

Visitantes, tráfego, páginas, localização e provedores mostrados são **dados de demonstração**. O painel não recebe eventos de analytics, não consulta serviços de geolocalização e não sabe se alguém está realmente acessando um site. O botão de atualização deixa isso explícito.

## Supabase

The initial database schema is in `supabase/migrations/20261101123000_vigia_initial_schema.sql`. Apply it to the Vigia Supabase project from its SQL Editor (or with the Supabase CLI after linking the project). It creates accounts' site registrations, page-event history, short-lived live presence, and private verification challenge storage with row-level security. Browser users cannot write analytics, publish verification, or read another owner's rows; those operations require a trusted server/Edge Function.

The browser uses the project's Supabase URL and publishable key for Auth and owner-scoped site/event reads. These are public client credentials; row-level security is still required. The dashboard can register sites after sign-in and reads event history and active presence from the schema. With no verified site or ingested events it continues to show an explicit no-data/demo state. The browser never writes event or presence records.

Before collecting real analytics for a customer site, deploy a trusted server/Edge Function for DNS/meta-tag ownership challenges and page-event/heartbeat ingestion, publish a small tracking snippet, add retention cleanup, and provide production privacy disclosures. Never put a `service_role` key in frontend code. Do not retain IP addresses; if coarse IP-derived enrichment is added server-side, discard the IP immediately after enrichment.

O formulário valida o domínio no navegador e apresenta uma prévia do fluxo de confirmação da propriedade, com instruções DNS TXT e meta tag. Os tokens são locais e prefixados como demonstração: não são publicados nem confirmados. Uma integração de produção deve emitir e validar desafios no servidor antes de coletar eventos. O painel não pede credenciais do domínio, hospedagem ou servidor.

A preferência de alerta sonoro fica no navegador e a ativação toca uma prévia curta. Não há notificação de visitas reais até que exista uma conexão de eventos em tempo real.

## Requisitos de privacidade para uma integração futura

- Coletar somente os dados necessários para métricas de páginas e localização/provedor aproximados.
- Usar o IP apenas transitoriamente para enriquecimento geográfico aproximado; não reter nem expor o endereço completo.
- Informar que geolocalização por IP pode ser imprecisa. Não inferir localização precisa nem criar fingerprint de visitantes.
- Definir retenção, controles de acesso e aviso de privacidade antes de coletar dados reais.
