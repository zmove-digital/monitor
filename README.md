# Vigia

Protótipo autocontido, sem dependências, de um painel de monitoramento de sites em português brasileiro.

## Executar

Abra `index.html` em um navegador moderno. Não há etapa de build ou instalação.

## Instalar no celular

O Vigia pode ser instalado como PWA pelo Chrome em um endereço HTTPS. Abra o endereço do app e use **Instalar app** (ou o menu do Chrome > **Instalar app** / **Adicionar à tela inicial**). Para teste local em um Android conectado por USB com depuração habilitada, sirva esta pasta em `localhost`, encaminhe a porta com `adb reverse` e abra `http://localhost:<porta>` no Chrome do celular. O servidor local precisa permanecer ativo durante o teste; a instalação de produção deve usar um endereço HTTPS permanente.

O service worker mantém apenas o shell estático do app em cache. Chamadas ao Supabase e dados de conta/analytics não são armazenados pelo cache offline.

## APK Android de teste

O projeto também pode ser empacotado com Capacitor. O APK de depuração contém a interface web do Vigia e usa o Supabase configurado em `supabase-config.js`; é necessário ter conexão com a internet para autenticar e carregar métricas. O endereço `trackerUrl` nessa configuração determina a URL do `vigia.js` mostrada no passo de instalação do snippet.

Requisitos de build: Node.js 22 ou superior, JDK 21 e Android SDK instalado com a plataforma Android 36. Na raiz do projeto, instale as dependências e gere o APK:

```sh
npm install
npm run android:debug
```

No PowerShell do Windows, use `npm.cmd` no lugar de `npm` se a política de execução bloquear scripts `.ps1`:

```powershell
npm.cmd install
npm.cmd run android:debug
```

O arquivo de teste é `android/app/build/outputs/apk/debug/app-debug.apk`. Para compilar localmente, abra a pasta `android` no Android Studio ou use `npm run android:sync` antes de sincronizar mudanças do app web. O ID inicial do app é `com.zmovedigital.vigia`; defina o ID final antes da primeira publicação na Play Store, pois ele identifica permanentemente o app na loja. A mudança posterior do endereço do app ou do rastreador exige atualizar a configuração, sincronizar e gerar um novo APK. A versão de teste não está assinada para distribuição na Play Store.

## Publicar no Cloudflare Pages

Crie um projeto no Cloudflare Pages conectado ao repositório GitHub `zmove-digital/monitor`. Configure o diretório raiz como `/`, sem framework, com o comando de build abaixo e `dist` como diretório de saída:

```sh
mkdir -p dist && cp index.html app.js styles.css supabase-config.js manifest.webmanifest service-worker.js dist/ && cp tracking/vigia.js dist/vigia.js && cp -r icons dist/icons
```

O nome do projeto no Cloudflare Pages pode ser `vigia`; o endereço `vigia.monitor.com` é um domínio personalizado separado. Para usá-lo, adicione `vigia.monitor.com` em **Custom domains** nas configurações do projeto Pages e configure no Cloudflare o DNS para o domínio `monitor.com`. É necessário ter controle desse domínio e de sua zona DNS no Cloudflare; siga o destino de DNS que o painel indicar e aguarde a validação do certificado HTTPS. Não altere os registros de `projetei.com` para publicar o Vigia.

Depois do deploy, defina `https://vigia.monitor.com` como URL do app em **Authentication → URL Configuration** no Supabase e inclua essa URL entre as URLs de redirecionamento permitidas.

## Recuperação de senha

O modal de login tem o link **Esqueci minha senha**. O app chama `POST /auth/v1/recover`; o Supabase envia um e-mail com um link que volta para o app com os tokens de recuperação no fragmento da URL. O app detecta `type=recovery`, abre o formulário de nova senha e, ao salvar, chama `PUT /auth/v1/user` e mantém o usuário conectado com a sessão de recuperação.

Configuração necessária no painel do Supabase:

1. Em **Authentication → URL Configuration**, defina **Site URL** com o endereço publicado do app (por exemplo `https://monitor-pge.pages.dev`).
2. Inclua em **Redirect URLs** as URLs usadas, por exemplo `https://monitor-pge.pages.dev/**` e `https://vigia.monitor.com/**`.
3. O SMTP padrão do Supabase é limitado (poucos e-mails por hora e somente para endereços autorizados no projeto). Para uso real, configure um SMTP próprio em **Authentication → SMTP Settings** (Resend, SendGrid, Amazon SES etc.).

No APK, o link do e-mail abre no navegador do sistema (o app não registra um App Link próprio): a nova senha é definida na página publicada e, em seguida, basta entrar no aplicativo com ela. Em `localhost` o app não envia `redirect_to`, para que o Supabase use a Site URL configurada.

## Limites do protótipo

Sem uma conta conectada e um site verificado com snippet instalado, os números do painel são **dados de demonstração**. Com as Edge Functions publicadas e o snippet instalado em um domínio verificado, page views, presença e cidades vêm dos eventos gravados no Supabase. O provedor de internet não é coletado e aparece como indisponível.

## Supabase e coleta de acessos

A migration `supabase/migrations/20261101123000_vigia_initial_schema.sql` cria o cadastro de sites, eventos de página, presença temporária e desafios privados de verificação com RLS. Ela já foi aplicada ao projeto VIGIA. As Edge Functions estão em `supabase/functions/`:

- `vigia-verification` cria tokens DNS TXT que expiram em 24 horas e só marca um site como verificado depois de encontrar o token no DNS público. A função exige a sessão autenticada do proprietário.
- `vigia-ingest` aceita page views, encerramentos e heartbeats apenas para domínios verificados, conferindo a origem do navegador contra o domínio cadastrado. Ele também deriva **cidade e país aproximados** do IP da requisição via ipwho.is: o IP é consultado momentaneamente em memória (cache de até 24 h por IP), descartado na sequência e nunca gravado; só a cidade e o código de país chegam ao banco.

Para publicar as funções no projeto `cmclojrcwjrfezoaidzw`, instale o [Supabase CLI](https://supabase.com/docs/guides/cli), autentique-se na sua máquina e execute:

```sh
npx supabase login
npx supabase functions deploy vigia-verification --project-ref cmclojrcwjrfezoaidzw
npx supabase functions deploy vigia-ingest --no-verify-jwt --project-ref cmclojrcwjrfezoaidzw
```

The CLI opens an authorization flow in the browser; sign in to the Supabase account that owns the project. These commands do not need the database password.
On Windows PowerShell, if script execution blocks `npx`, use `npx.cmd` instead. Run the deploy commands from the repository root, the directory containing `supabase\functions\vigia-verification\index.ts`.

O runtime do Supabase fornece `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` às funções. A chave administrativa é usada somente no servidor e nunca deve ser copiada para o app, para o site monitorado, para o GitHub ou para uma conversa. Não é necessário compartilhar a senha do banco.

Depois de publicar as funções e fazer um novo deploy do Pages, registre o domínio no painel, publique o TXT indicado pelo Vigia e confirme a verificação. Após a confirmação, copie o snippet exibido pelo app e coloque-o antes do fechamento de `</body>` em cada página que deseja medir. O trecho carregado é `tracking/vigia.js`, publicado como `/vigia.js` no Pages. O painel coleta page views e presença ativa, com heartbeat a cada 25 segundos e expiração da presença após 90 segundos.

O snippet envia somente o domínio do site, um identificador aleatório efêmero por aba, o caminho da página sem query string nem fragmento, o domínio de referência e duração aproximada. **Nenhum IP é lido, armazenado ou enviado pelo código do Vigia.** A cidade e o país aproximados são derivados **no servidor** pela Edge Function de ingestão, usando o IP da requisição apenas por um instante (cache de até 24 h por IP); o IP nunca é gravado no banco nem nos logs do código. O provedor de internet não é coletado. O identificador de sessão é mantido em `sessionStorage` e termina com a sessão da aba. O proprietário do site deve informar os visitantes sobre analytics e configurar consentimento quando exigido pela legislação aplicável.

O endpoint de ingestão é público por natureza; ele exige site verificado e confere a origem do navegador, mas não inclui ainda limitação distribuída de taxa nem proteção contra clientes que falsifiquem cabeçalhos HTTP fora de um navegador. Trate esta versão como piloto controlado, não como serviço endurecido para produção. Também defina uma política de retenção e configure a limpeza periódica de eventos antes de ampliar a coleta.

A preferência de alerta sonoro fica no navegador e a ativação toca uma prévia curta. O painel oferece quatro toques (Clássico, Suave, Urgente e Sino) em um seletor ao lado do interruptor; a escolha fica salva e a prévia toca a cada troca. Quando há presença real, o painel consulta o Supabase a cada 15 segundos e o botão de atualizar força a recarga imediata, marcando o horário da última atualização.

## Origem do tráfego

O painel **De onde vêm** agrupa os visitantes em canais a partir do primeiro referenciador da sessão:

- **Google (busca)**: referenciador de qualquer domínio `google.*` (inclusive `www.google.com.br`), o app Google no Android (`com.google.android.googlequicksearchbox`) ou `utm_source=google` sem sinal de anúncio.
- **Google Ads**: presença de `gclid`, `gbraid`, `wbraid`, `dclid` ou `gad_source` na URL, ou `utm_source=google` com `utm_medium` de mídia paga.
- **Acesso direto**: nenhum referenciador e nenhum sinal de campanha do Google.
- **Redes sociais** e **Outras buscas**: domínios conhecidos dessas categorias.
- **Outros sites**: demais referenciadores.

O snippet guarda a origem da primeira página vista em `sessionStorage` e reaproveita essa origem nas navegações seguintes, então quem chega pelo Google e continua navegando no site não passa a contar como acesso direto. A contagem por canal usa visitantes únicos (sessões), e não page views.

**Limite importante:** só é possível identificar o Google quando o navegador envia o referenciador ou parâmetros de campanha. Visitas com referenciador removido (apps, modo privado, política `no-referrer`, HTTP→HTTPS) permanecem como **Acesso direto** e não há como saber se vieram de busca. O botão **Ver todas as origens** mostra os domínios brutos que mais contribuíram para os canais.

A barra de navegação foi movida para o **topo** (marca, seletor de site, seções e conta), deixando os painéis ocupando toda a largura. Na largura de celular as seções ficam só com ícones.

## Cidades por visita

O painel consulta cidade e país derivados no servidor e mostra dois blocos:

- **Cidades**: todas as cidades que registraram acessos no período, com visitantes únicos e a participação relativa à líder.
- **Top 5 cidades**: as cinco com mais visitantes únicos no período, com barra comparativa.

Enquanto a Edge Function de ingestão não for republicada com o enriquecimento por cidade (ou enquanto as visitas antigas não tiverem cidade), os blocos mostram “nenhuma cidade identificada”; eventos novos passam a registrar cidade automaticamente, sem migration adicional — as colunas `city` e `country_code` já existiam no esquema.

## Requisitos de privacidade

- Coletar somente os dados necessários para métricas de páginas, cidade e país aproximados.
- O código do snippet não usa nem envia IP. No servidor, o IP é lido apenas por um instante para derivar cidade e país e imediatamente descartado; o endereço completo não é retido, gravado no banco nem exposto nos painéis.
- Informar que geolocalização por IP é aproximada e pode ser imprecisa. Não inferir localização precisa nem criar fingerprint de visitantes.
- Definir retenção, controles de acesso e aviso de privacidade antes de coletar dados reais.
