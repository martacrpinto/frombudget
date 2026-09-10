# Checklist Supabase / Vercel

## Supabase

- [ ] Criar projeto Free e guardar URL, anon key e service role key fora do repositório.
- [ ] Aplicar migrations numa base vazia; ativar RLS em todas as tabelas expostas.
- [ ] Criar policies por papel e bucket privado para avatares/exports.
- [ ] Ativar Realtime apenas para budgets, comentários, estados e categorias.
- [ ] Configurar Auth redirect para domínio Vercel e recovery URL.
- [ ] Importar cópia, reconciliar contagens/totais e criar primeiro export validado.

## Vercel

- [ ] Ligar repositório Git privado pessoal; `main` é produção e branches são previews.
- [ ] Configurar root directory para `Budget Solution Cloud/client` (ou root definido pelo build final).
- [ ] Definir apenas variáveis `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` no cliente.
- [ ] Nunca colocar service role key em variáveis `VITE_*` nem no browser.
- [ ] Configurar fallback SPA (`/*` para `index.html`) e testar refresh em todas as rotas.
- [ ] Testar preview com admin e utilizador normal antes de promover produção.
