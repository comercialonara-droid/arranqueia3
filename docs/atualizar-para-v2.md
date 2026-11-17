# Atualizar o Railway para a versão 2

A versão 2 muda bastante coisa por dentro (várias lojas, logins por pessoa, simulação, áudios). O banco novo é outro arquivo (`arranque-v2.db`), então a loja começa do zero e o estoque da FA é carregado de novo sozinho.

1. **Suba os arquivos novos no GitHub**, do mesmo jeito da primeira vez (tudo de dentro da pasta `arranque`, por cima dos antigos).
2. **No Railway, em Variables**, confira estas variáveis:
   - `ADMIN_EMAIL` = o login do administrador (ex.: `elias`)
   - `ADMIN_PASSWORD` = a senha do administrador
   - `SESSION_SECRET`, `PUBLIC_URL`, `SEED_FILE=seed/fa-veiculos.json` e `PORT=3000` continuam iguais
   - `ANTHROPIC_API_KEY` = a chave da Anthropic (sem ela, o sistema fica no modo de teste, com respostas prontas)
3. **Deploy.** O volume em `/app/data` continua o mesmo.
4. **Entre no painel** com o `ADMIN_EMAIL` e a `ADMIN_PASSWORD`.
5. Em **Equipe**, preencha o WhatsApp do Beto e gere a senha dele e a do Fabrício (botão "Nova senha"). Mande os acessos para eles.
6. Em **Áudios do vendedor**, suba os áudios gravados pelo Beto.
7. Teste em **Testar a IA** antes de ligar o WhatsApp.
