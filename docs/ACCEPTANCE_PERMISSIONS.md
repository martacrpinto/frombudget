# Matriz de permissões e aceitação

| Capacidade | Anónimo | Utilizador próprio | Approver | Admin |
|---|---:|---:|---:|---:|
| Ler próprio budget | Não | Sim | Sim | Sim |
| Editar próprio budget draft | Não | Sim | Sim | Sim |
| Editar budget alheio | Não | Não | Conforme permissão | Sim |
| Submeter próprio | Não | Sim | Sim | Sim |
| Validar página | Não | Não | Sim | Sim |
| Criar ano/categoria | Não | Conforme flag | Conforme flag | Sim |
| Limpar dados | Não | Conforme flag | Conforme flag | Sim |
| Ver auditoria | Não | Conforme página | Sim | Sim |
| Gerir utilizadores/permissões | Não | Não | Não | Sim |

Testar cada célula por UI e por chamada direta à API/Supabase. Resultado esperado para negações: erro 401/403 e nenhum registo alterado. A identidade deve vir de `auth.uid()`, nunca de um `userId` fornecido pelo cliente.

## Aceitação mínima

- [ ] Contagens e totais do backup coincidem por ano, utilizador, categoria e mês.
- [ ] RLS impede leitura/escrita cruzada e bypass de página validada.
- [ ] Autosave, colagem Excel, comentários, remuneração, auditoria e XLSX funcionam após refresh.
- [ ] Realtime entrega alteração concorrente e Presence mostra utilizadores online.
- [ ] Deep links e refresh funcionam na Vercel; nenhum segredo aparece no bundle.
