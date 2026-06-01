/* ============================================================================
   supabase-client.js — one Supabase client + auth helpers for the whole app.

   HOW TO WIRE (add to the <head> or end of <body> of each page, in this order):
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
     <script src="supabase-client.js"></script>
     <script src="egfulfill-store.js"></script>
     <script src="egstore-supabase.js"></script>   ← the sync bridge

   FILL IN your project's values below (Supabase → Project Settings → API):
     • Project URL          → SUPABASE_URL
     • anon / public key     → SUPABASE_ANON_KEY   (safe to ship — RLS protects data)
   NEVER put the service_role key here; that belongs only in Vercel env vars.
   ============================================================================ */
(function () {
  'use strict';

  var SUPABASE_URL      = 'https://YOUR-PROJECT-ref.supabase.co';
  var SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';

  if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
    console.error('[supabase] supabase-js not loaded — add the CDN <script> before supabase-client.js');
    return;
  }

  // Single shared client for the page. Persists the session in localStorage so
  // a logged-in user stays logged in across pages/reloads.
  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
  window.sb = sb;

  // ── Auth helpers used by the login / signup pages ─────────────────────────
  window.EGAuth = {
    client: sb,

    // role is stored on the user (user_metadata.role) and copied into the
    // profiles table by the handle_new_user() trigger in schema.sql.
    signUp: function (email, password, opts) {
      opts = opts || {};
      return sb.auth.signUp({
        email: email, password: password,
        options: { data: { role: opts.role || 'seller', name: opts.name || '', store_name: opts.store_name || '' } }
      });
    },
    signIn: function (email, password) {
      return sb.auth.signInWithPassword({ email: email, password: password });
    },
    signOut: function () { return sb.auth.signOut(); },

    getSession: function () { return sb.auth.getSession().then(function (r) { return r.data.session; }); },
    getUser:    function () { return sb.auth.getUser().then(function (r) { return r.data.user; }); },

    // Resolve the current user's role from the profiles table.
    getRole: function () {
      return sb.auth.getUser().then(function (r) {
        var u = r.data.user; if (!u) return null;
        return sb.from('profiles').select('role').eq('id', u.id).single()
          .then(function (p) { return (p.data && p.data.role) || (u.user_metadata && u.user_metadata.role) || null; });
      });
    },

    // Fire a callback whenever the auth state changes (login/logout/refresh).
    onChange: function (cb) { return sb.auth.onAuthStateChange(function (_e, session) { cb(session); }); },

    // Convenience guard for a page: redirect to login if not signed in.
    requireLogin: function (loginUrl) {
      return this.getSession().then(function (s) {
        if (!s && loginUrl) { window.location.href = loginUrl; }
        return s;
      });
    }
  };
})();
