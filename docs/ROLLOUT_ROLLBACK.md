# Runbook de rollout e rollback

1. Congelar alterações na app local e copiar o backup de referência para uma pasta de migração.
2. Aplicar schema/policies numa instância Supabase vazia e executar import idempotente.
3. Executar reconciliação; parar se qualquer contagem ou total divergir.
4. Publicar preview Vercel e executar a matriz de permissões e fluxos críticos.
5. Convidar os 7 utilizadores apenas após aprovação dos dois admins (Bianca Levy e Benedita C. Machado).
6. Promover `main`, manter a app local em modo somente leitura durante o piloto e guardar snapshot manual.

## Rollback

- Desativar o domínio/produção Vercel e apontar para o último deployment conhecido.
- Se os dados divergirem, impedir novas escritas, exportar tabelas afetadas e restaurar a cópia SQLite original local.
- Não apagar o projeto Supabase: preservar logs e snapshot para diagnóstico. Repetir import numa instância/tabelas de staging após corrigir a causa.
- Reabrir escrita apenas depois de reconciliação e teste de login/permissões.
