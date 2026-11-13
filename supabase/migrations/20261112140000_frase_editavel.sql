-- Frase nos dois idiomas, editável: o dono corrige a frase de um encontro, a tradução dela
-- na língua nativa e o trecho destacado (o servidor acha a palavra de novo na frase nova).
-- Só esses três campos e só encontros não apagados. O único gatilho em encounters é
-- encounters_release_leech, que roda só no insert: editar não solta teimosa em espera.

grant update (sentence, translation, highlight) on public.encounters to authenticated;

create policy "dono edita as frases dos próprios encontros" on public.encounters
  for update to authenticated
  using ((select auth.uid()) = user_id and deleted_at is null)
  with check ((select auth.uid()) = user_id and deleted_at is null);
