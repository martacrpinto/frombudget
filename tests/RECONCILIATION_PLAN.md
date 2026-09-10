# Plano de testes automatizáveis de reconciliação

O teste recebe `SOURCE_SQLITE` e credenciais Supabase por ambiente (nunca hardcoded), lê apenas dados e falha com código não-zero em divergência.

## Verificações

1. Contar entidades: users=7, categories=12, budget_years=2, budget_entries=926, audit_log=1059, user_category_order=30, year_categories=52, remuneration_ftes=15, remuneration_config=3, page_comments=1, page_status=1, user_roles=4, user_permissions=1.
2. Contar entradas por ano: 2026=480 e 2027=446.
3. Agrupar `budget_entries` por `(year,user_id,category_id,month)` e comparar soma/valor com tolerância decimal de 0,01.
4. Comparar totais por ano, utilizador, categoria e mês; reportar chaves apenas de uma origem.
5. Verificar unicidade da chave `(user,category,year,month)` e FKs sem órfãos.
6. Confirmar que os 5 exports inválidos foram excluídos e que existe pelo menos um export novo válido.

## Testes de segurança não destrutivos

- Sessão anónima: cada tabela exposta devolve 401/403 ou zero linhas.
- Utilizador A tenta ler/escrever página de B: falha e o hash/contagem dos dados não muda.
- Approver valida página draft; utilizador normal não consegue validar.
- Após validação, tentativa de update direto falha.
- Auditoria de alteração contém `auth.uid()` e não aceita autor arbitrário.
