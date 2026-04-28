// =============================================================================
// _admin-test-setup-envelope (NEUTERED)
//
// Previous version was a smoke-test helper used to verify the native
// signing pipeline end-to-end on 2026-04-27. After successful test
// it has been overwritten with a deny-all stub. The slot remains
// occupied because the deploy API has no delete; Nicholas can
// fully remove it later via the Supabase dashboard.
// =============================================================================

Deno.serve((_req) => {
  return new Response(
    JSON.stringify({
      error: "This endpoint has been retired. The smoke-test helper used to live here.",
    }),
    { status: 410, headers: { "Content-Type": "application/json" } },
  )
})
